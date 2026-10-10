// The CV worker of CXact: one route, POST /v1/cv. It checks the request, reserves a try in the
// usage counters (D1: the install's and the address's, usage.ts),
// sends the CV to OpenRouter with a strict JSON schema and answers with the AI part of the
// profile. A try counts once OpenRouter charged for it, also when the answer is no profile.
// Every error is {code, params}, never prose; the app words it. The install id and the address
// never go upstream; the log holds codes, sizes and cost only.

import PROMPT_FILE from './prompt.de.md';
import SCHEMA from '../schema.json';
import { calendar, isFree, remaining, slots, type Call, type Slot } from './usage';

interface Env {
  DB: D1Database;
  OPENROUTER_API_KEY: string;
  IP_PEPPER: string;
  PAUSED: string;
  /** The OpenRouter model; unset means DEFAULT_MODEL. */
  MODEL?: string;
  /** The reasoning effort, low, medium or high; anything else means DEFAULT_EFFORT. */
  EFFORT?: string;
}

/** Version of the request; older builds get `outdated`. */
const REQUEST_SCHEMA = 1;
const MAX_TEXT = 100_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 15;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** One PDF or five photos in base64, with room for the JSON around them. */
const MAX_BODY = 40 * 1024 * 1024;
/** Below the app's own timeout (160 s), so the app hears the code. */
const UPSTREAM_TIMEOUT_MS = 150_000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const DEFAULT_EFFORT = 'low';
const EFFORTS = new Set(['low', 'medium', 'high']);
const PDF = 'application/pdf';
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROMPT = PROMPT_FILE.replace(/^<!--[\s\S]*?-->\s*/, '');

type Code =
  'invalid' | 'notFound' | 'paused' | 'outdated' | 'tooLarge' | 'limit' | 'refused' | 'unavailable';

const STATUS: Record<Code, number> = {
  invalid: 400,
  notFound: 404,
  paused: 503,
  outdated: 400,
  tooLarge: 413,
  limit: 429,
  refused: 422,
  unavailable: 502,
};

type Params = Record<string, string>;

interface Failure {
  code: Code;
  params?: Params;
  /** For the log only: why upstream failed (status or cause), or which counter is full. */
  detail?: string;
  /** For the log only: the call to OpenRouter, when one was made. */
  call?: Call;
  /** For the log only: whether the tries went back or count. */
  tries?: 'returned' | 'counted';
}

interface CvFile {
  mime: string;
  data: string;
  bytes: number;
}

type CvRequest = { installId: string } & (
  { kind: 'text'; text: string } | { kind: 'files'; files: CvFile[] }
);

interface Answer {
  profile: Record<string, unknown>;
  costUsd: number | null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/cv') {
      return failure({ code: 'notFound' }, started);
    }
    if (env.PAUSED === 'true') {
      return failure({ code: 'paused' }, started);
    }
    const cv = await readRequest(request);
    if ('code' in cv) {
      return failure(cv, started);
    }
    const size = cv.kind === 'text' ? cv.text.length : cv.files.reduce((n, f) => n + f.bytes, 0);
    const days = calendar(new Date());
    let plan: Slot[];
    try {
      const ip = await ipKey(env, request.headers.get('CF-Connecting-IP') ?? '');
      plan = slots(cv.installId, ip, days);
    } catch {
      return failure({ code: 'unavailable', detail: 'config' }, started, cv.kind, size);
    }
    const taken: Slot[] = [];
    const counts = new Map<Slot['name'], number>();
    for (const slot of plan) {
      let n: number | null;
      try {
        n = await reserve(env.DB, slot);
      } catch {
        await release(env.DB, taken);
        return failure({ code: 'unavailable', detail: 'db' }, started, cv.kind, size);
      }
      if (n === null) {
        await release(env.DB, taken);
        const full: Failure = { code: 'limit', params: { until: slot.until }, detail: slot.name };
        return failure(full, started, cv.kind, size);
      }
      taken.push(slot);
      counts.set(slot.name, n);
    }
    const answer = await askAi(env, cv);
    if ('code' in answer) {
      // Only a call that cost nothing gives its tries back; a charged one counts.
      const free = isFree(answer.call);
      if (free) {
        await release(env.DB, taken);
      }
      const tries = free ? 'returned' : 'counted';
      return failure({ ...answer, tries }, started, cv.kind, size);
    }
    const left = remaining(counts.get('month') ?? 0, counts.get('day') ?? 0, days);
    const body: Record<string, unknown> = {
      profile: answer.profile,
      remainingToday: left.remainingToday,
      costUsd: answer.costUsd,
    };
    if (left.until !== null) {
      body.until = left.until;
    }
    log({ code: 'ok', kind: cv.kind, size, costUsd: answer.costUsd, ms: Date.now() - started });
    return json(body, 200);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      env.DB.prepare(
        `DELETE FROM cv_usage
         WHERE (length(day) = 10 AND day < date('now', '-31 days'))
            OR (length(day) = 7 AND day < strftime('%Y-%m', 'now', '-31 days'))`,
      )
        .run()
        .then((result) => log({ code: 'cleanup', rows: result.meta.changes }))
        .catch(() => log({ code: 'cleanupFailed' })),
    );
  },
} satisfies ExportedHandler<Env>;

/* ---------------------------------------------------------------- request */

async function readRequest(request: Request): Promise<CvRequest | Failure> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY) {
    return { code: 'tooLarge' };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { code: 'invalid' };
  }
  if (raw.length > MAX_BODY) {
    return { code: 'tooLarge' };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { code: 'invalid' };
  }
  if (!isObject(body)) {
    return { code: 'invalid' };
  }
  if (body.schema !== REQUEST_SCHEMA) {
    return { code: 'outdated' };
  }
  const installId = body.installId;
  if (typeof installId !== 'string' || !INSTALL_ID.test(installId)) {
    return { code: 'invalid' };
  }
  if (body.kind === 'text') {
    const text = body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return { code: 'invalid' };
    }
    return text.length > MAX_TEXT ? { code: 'tooLarge' } : { installId, kind: 'text', text };
  }
  if (body.kind !== 'files' || !Array.isArray(body.files) || body.files.length === 0) {
    return { code: 'invalid' };
  }
  const files: CvFile[] = [];
  for (const file of body.files as unknown[]) {
    if (!isObject(file) || typeof file.mime !== 'string' || typeof file.dataBase64 !== 'string') {
      return { code: 'invalid' };
    }
    if (file.mime !== PDF && !IMAGES.has(file.mime)) {
      return { code: 'invalid' };
    }
    const data = file.dataBase64;
    files.push({ mime: file.mime, data, bytes: Math.floor((data.length * 3) / 4) });
  }
  const pdfs = files.filter((f) => f.mime === PDF);
  const images = files.length - pdfs.length;
  if (pdfs.length > 1 || (pdfs.length === 1 && images > 0)) {
    return { code: 'invalid' };
  }
  if (images > MAX_IMAGES || files.some((f) => f.mime !== PDF && f.bytes > MAX_IMAGE_BYTES)) {
    return { code: 'tooLarge' };
  }
  const pdf = pdfs[0];
  if (pdf !== undefined) {
    if (pdf.bytes > MAX_PDF_BYTES) {
      return { code: 'tooLarge' };
    }
    const pages = pdfPages(pdf.data);
    if (pages === null) {
      return { code: 'invalid' };
    }
    if (pages > MAX_PDF_PAGES) {
      return { code: 'tooLarge' };
    }
  }
  return { installId, kind: 'files', files };
}

/** Page objects of a PDF where they are visible (0 when they sit in compressed object
 * streams: not detectable, then the size limit alone decides); `null` when it is no base64. */
function pdfPages(base64: string): number | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  return binary.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ usage */

/** Reserves one try in one statement; `null` when the counter is full. */
async function reserve(db: D1Database, slot: Slot): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO cv_usage (key, day, n) VALUES (?1, ?2, 1)
       ON CONFLICT (key, day) DO UPDATE SET n = n + 1 WHERE n < ?3
       RETURNING n`,
    )
    .bind(slot.key, slot.day, slot.limit)
    .first<{ n: number }>();
  return row === null ? null : row.n;
}

/** Gives the tries back: of a request a full counter stopped, or whose AI call cost nothing
 * (`isFree`). */
async function release(db: D1Database, taken: Slot[]): Promise<void> {
  if (taken.length === 0) {
    return;
  }
  try {
    await db.batch(
      taken.map((slot) =>
        db
          .prepare('UPDATE cv_usage SET n = n - 1 WHERE key = ?1 AND day = ?2 AND n > 0')
          .bind(slot.key, slot.day),
      ),
    );
  } catch {
    log({ code: 'releaseFailed' });
  }
}

/** The counter key of an address: HMAC-SHA256 with the pepper, IPv6 by its /64. Throws
 * without a pepper, so a raw address is never stored. */
async function ipKey(env: Env, ip: string): Promise<string> {
  if (!env.IP_PEPPER) {
    throw new Error('IP_PEPPER missing');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.IP_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(ipPrefix(ip)));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ip:${hex.slice(0, 32)}`;
}

/** An IPv4 address as it is, an IPv6 address as its /64 prefix (one household or line). */
function ipPrefix(address: string): string {
  const ip = address.trim().toLowerCase().split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1] !== undefined) {
    return mapped[1];
  }
  if (!ip.includes(':')) {
    return ip;
  }
  const [head = '', tail = ''] = ip.split('::', 2);
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const front = groups(head);
  const back = groups(tail);
  // An embedded IPv4 address at the end takes two groups.
  const width = (list: string[]) => list.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const missing = Math.max(0, 8 - width(front) - width(back));
  const all = ip.includes('::') ? [...front, ...Array<string>(missing).fill('0'), ...back] : front;
  const prefix = all.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16));
  return `${prefix.join(':')}::/64`;
}

/* --------------------------------------------------------------------- AI */

interface Choice {
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  error?: unknown;
  message?: { content?: string | null; refusal?: string | null };
}

interface Completion {
  error?: unknown;
  choices?: Choice[];
  usage?: { cost?: number };
}

/** A failed AI call, with what OpenRouter answered (`isFree` decides on its tries). */
type AiFailure = Failure & { call: Call };

async function askAi(env: Env, cv: CvRequest): Promise<Answer | AiFailure> {
  const content =
    cv.kind === 'text'
      ? [{ type: 'text', text: `<cv>\n${cv.text.replaceAll('</cv>', '</ cv>')}\n</cv>` }]
      : cv.files.map((file) =>
          // A neutral file name: the user's own may carry their name.
          file.mime === PDF
            ? {
                type: 'file',
                file: { filename: 'cv.pdf', file_data: `data:${PDF};base64,${file.data}` },
              }
            : { type: 'image_url', image_url: { url: `data:${file.mime};base64,${file.data}` } },
        );
  const hasPdf = cv.kind === 'files' && cv.files.some((f) => f.mime === PDF);
  const request: Record<string, unknown> = {
    model: env.MODEL?.trim() || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content },
    ],
    max_tokens: 8000,
    reasoning: { effort: EFFORTS.has(env.EFFORT ?? '') ? env.EFFORT : DEFAULT_EFFORT },
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'profil', strict: true, schema: SCHEMA },
    },
    provider: {
      order: ['google-vertex/europe'],
      allow_fallbacks: false,
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
    },
    usage: { include: true },
  };
  if (hasPdf) {
    request.plugins = [{ id: 'file-parser', pdf: { engine: 'native' } }];
  }
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'CXact',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    // No answer came, so nothing was charged.
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    const call: Call = { status: null, costUsd: null };
    return { code: 'unavailable', detail: timeout ? 'timeout' : 'network', call };
  }
  let completion: Completion | null;
  try {
    completion = await response.json<Completion | null>();
  } catch {
    completion = null;
  }
  const call: Call = { status: response.status, costUsd: cost(completion) };
  if (!response.ok) {
    // 402: the credits are used up; 429 and 5xx: the provider; 400: the request.
    return { code: 'unavailable', detail: `http ${response.status}`, call };
  }
  if (completion === null) {
    return { code: 'unavailable', detail: 'body', call };
  }
  const choice = completion.choices?.[0];
  if (completion.error !== undefined || choice === undefined || choice.error !== undefined) {
    return { code: 'unavailable', detail: 'error', call };
  }
  const refused =
    choice.finish_reason === 'length' ||
    choice.finish_reason === 'content_filter' ||
    choice.native_finish_reason === 'refusal' ||
    (typeof choice.message?.refusal === 'string' && choice.message.refusal !== '');
  if (refused) {
    return { code: 'refused', detail: choice.finish_reason ?? 'refusal', call };
  }
  const profile = parseProfile(choice.message?.content);
  return profile === null
    ? { code: 'refused', detail: 'shape', call }
    : { profile, costUsd: call.costUsd };
}

/** The cost an answer names, to a millionth of a dollar; `null` when it names none. */
function cost(completion: Completion | null): number | null {
  const value = completion?.usage?.cost;
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

/** The answer as a profile of the schema's shape, or `null` (never half a profile). The
 * industries never carry the star: that is the user's wish, not the CV's. */
function parseProfile(content: string | null | undefined): Record<string, unknown> | null {
  if (typeof content !== 'string') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isObject(value)) {
    return null;
  }
  const lists = [
    'wunschrollen',
    'kernkompetenzen',
    'methoden_tools',
    'branchen',
    'sprachen',
    'abschluesse',
    'zertifizierungen',
  ];
  if (lists.some((key) => !Array.isArray(value[key]))) {
    return null;
  }
  const years = value.berufserfahrung_jahre;
  if (years !== null && typeof years !== 'number') {
    return null;
  }
  value.branchen = (value.branchen as unknown[]).map((entry) =>
    isObject(entry) ? { ...entry, wunsch: false } : entry,
  );
  return value;
}

/* --------------------------------------------------------------- response */

function failure(fail: Failure, started: number, kind?: string, size?: number): Response {
  log({
    code: fail.code,
    detail: fail.detail,
    kind,
    size,
    costUsd: fail.call?.costUsd,
    tries: fail.tries,
    ms: Date.now() - started,
  });
  return json({ code: fail.code, params: fail.params ?? {} }, STATUS[fail.code]);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** One log line of codes, sizes and cost: never a text, a file, an id or an address. */
function log(fields: Record<string, string | number | null | undefined>): void {
  console.log(JSON.stringify(fields));
}
