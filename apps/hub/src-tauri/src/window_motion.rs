use std::time::Duration;

pub(crate) const TIMEOUT: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub(crate) trait Surface {
    type Error;
    fn is_visible(&self) -> Result<bool, Self::Error>;
    fn geometry(&self) -> Result<Option<Geometry>, Self::Error>;
    fn set_size(&self, width: u32, height: u32) -> Result<(), Self::Error>;
    fn set_position(&self, x: i32, y: i32) -> Result<(), Self::Error>;
    fn set_cloaked(&self, cloaked: bool) -> Result<(), Self::Error>;
    fn show(&self) -> Result<(), Self::Error>;
    fn hide(&self) -> Result<(), Self::Error>;
    fn visibility(&self, visible: bool);
    fn motion(&self, snapshot: MotionSnapshot);
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    #[default]
    Hidden,
    Waiting,
    Entering,
    Open,
    Exiting,
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub(crate) struct MotionSnapshot {
    pub phase: Phase,
    pub generation: u64,
    pub sequence: u64,
}

#[derive(Default)]
pub(crate) struct Coordinator {
    snapshot: MotionSnapshot,
    geometry: Option<Geometry>,
    awaiting_reduced: bool,
    cloaked: bool,
}

impl Coordinator {
    fn next_generation(&mut self) -> u64 {
        self.snapshot.generation = self.snapshot.generation.wrapping_add(1);
        self.snapshot.generation
    }

    fn publish<S: Surface>(&mut self, surface: &S, phase: Phase) {
        self.snapshot.phase = phase;
        self.snapshot.sequence = self.snapshot.sequence.wrapping_add(1);
        surface.motion(self.snapshot);
    }

    pub(crate) fn snapshot(&self) -> MotionSnapshot {
        self.snapshot
    }

    pub(crate) fn is_exiting(&self) -> bool {
        self.snapshot.phase == Phase::Exiting
    }

    pub(crate) fn pending_paint(&self) -> Option<u64> {
        (self.snapshot.phase == Phase::Waiting).then_some(self.snapshot.generation)
    }

    pub(crate) fn show<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<u64>, S::Error> {
        let visible = surface.is_visible()?;
        if visible && !self.is_exiting() {
            return Ok(None);
        }
        let generation = self.next_generation();
        if !visible {
            let Some(bounds) = surface.geometry()?.or(self.geometry) else {
                return Ok(None);
            };
            surface.set_size(bounds.width, bounds.height)?;
            surface.set_position(bounds.x, bounds.y)?;
            self.geometry = Some(bounds);
            if self.cloaked {
                surface.set_cloaked(false)?;
                self.cloaked = false;
            }
            self.awaiting_reduced = reduced;
            self.publish(surface, Phase::Waiting);
            surface.show()?;
            surface.visibility(true);
            return Ok(None);
        }
        if reduced {
            self.publish(surface, Phase::Open);
            Ok(None)
        } else {
            self.publish(surface, Phase::Entering);
            Ok(Some(generation))
        }
    }

    pub(crate) fn painted<S: Surface>(
        &mut self,
        surface: &S,
        generation: u64,
    ) -> Result<Option<u64>, S::Error> {
        if self.pending_paint() != Some(generation) {
            return Ok(None);
        }
        if self.awaiting_reduced {
            self.publish(surface, Phase::Open);
            Ok(None)
        } else {
            self.publish(surface, Phase::Entering);
            Ok(Some(generation))
        }
    }

    pub(crate) fn hide<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<u64>, S::Error> {
        if !surface.is_visible()? || self.is_exiting() {
            return Ok(None);
        }
        let awaiting_paint = self.pending_paint().is_some();
        let generation = self.next_generation();
        if reduced || awaiting_paint {
            self.finish_hide(surface)?;
            return Ok(None);
        }
        self.publish(surface, Phase::Exiting);
        Ok(Some(generation))
    }

    pub(crate) fn toggle<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<u64>, S::Error> {
        if surface.is_visible()? && !self.is_exiting() {
            self.hide(surface, reduced)
        } else {
            self.show(surface, reduced)
        }
    }

    // Both the frontend acknowledgement and the bounded watchdog use this path.
    pub(crate) fn finish<S: Surface>(
        &mut self,
        surface: &S,
        generation: u64,
    ) -> Result<(), S::Error> {
        if generation != self.snapshot.generation {
            return Ok(());
        }
        match self.snapshot.phase {
            Phase::Entering => {
                self.next_generation();
                self.publish(surface, Phase::Open);
            }
            Phase::Exiting => self.finish_hide(surface)?,
            _ => {}
        }
        Ok(())
    }

    fn finish_hide<S: Surface>(&mut self, surface: &S) -> Result<(), S::Error> {
        // Cloak before hide, even if DWM is unavailable; never move on hide.
        if surface.set_cloaked(true).is_ok() {
            self.cloaked = true;
        }
        surface.hide()?;
        self.next_generation();
        self.publish(surface, Phase::Hidden);
        surface.visibility(false);
        Ok(())
    }

    pub(crate) fn abort<S: Surface>(&mut self, surface: &S) -> Result<(), S::Error> {
        self.next_generation();
        if surface.is_visible()? {
            self.finish_hide(surface)?;
        }
        Ok(())
    }
}
