//! Word lists of the engine, split by topic.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. Every table is re-exported here, so `lex::NAME` paths stay stable.

mod classes;
mod concepts;
mod contact;
mod contract;
mod cues;
mod exclusion;
mod level;
mod morphology;
mod pay;
mod places;
mod sections;
mod time;
mod tokens;

pub(crate) use classes::*;
pub(crate) use concepts::*;
pub(crate) use contact::*;
pub(crate) use contract::*;
pub(crate) use cues::*;
pub(crate) use exclusion::*;
pub(crate) use level::*;
pub(crate) use morphology::*;
pub(crate) use pay::*;
pub(crate) use places::*;
pub(crate) use sections::*;
pub(crate) use time::*;
pub(crate) use tokens::*;
