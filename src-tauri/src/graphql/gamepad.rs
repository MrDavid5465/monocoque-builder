use crate::gamepad;
use async_graphql::{Object, Result as GqlResult};

#[derive(Default)]
pub struct GamepadMutation;

#[Object]
impl GamepadMutation {
    /// Sets the DDController virtual gamepad's button state. `watchdog: true`
    /// marks this as a held press the caller will keep refreshing — see
    /// `gamepad::set_button`'s doc comment for the full stuck-input rationale.
    async fn gamepad_button(
        &self,
        button_index: u8,
        pressed: bool,
        #[graphql(default)] watchdog: bool,
    ) -> GqlResult<bool> {
        gamepad::set_button(button_index, pressed, watchdog).map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Sets the DDController virtual gamepad's axis value (-1.0..1.0).
    async fn gamepad_axis(&self, axis_index: u8, value: f32) -> GqlResult<bool> {
        gamepad::set_axis(axis_index, value).map_err(async_graphql::Error::new)?;
        Ok(true)
    }
}
