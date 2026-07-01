pub mod chat_model;
pub mod cli;
mod util;
pub mod events;
pub mod protocol;
pub mod pty;
pub mod session;
pub mod transport;

pub use events::{AppEvent, Command, PermissionDecision};
pub use protocol::SpawnConfig;
pub use transport::{spawn_session, SessionHandle};
