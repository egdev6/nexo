use std::time::Duration;

pub(crate) const DURATION: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub offscreen_x: i32,
    pub park_x: i32,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Animation {
    pub generation: u64,
    pub from: i32,
    pub to: i32,
    pub y: i32,
    pub exit: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Frame {
    Cancel,
    Move(i32),
    Finish(i32),
}

// Pure math also decides whether a worker has been superseded.
pub(crate) fn frame(animation: &Animation, generation: u64, elapsed: Duration) -> Frame {
    if animation.generation != generation {
        return Frame::Cancel;
    }
    if elapsed >= DURATION {
        return Frame::Finish(animation.to);
    }
    let t = elapsed.as_secs_f64() / DURATION.as_secs_f64();
    let eased = 1.0 - (1.0 - t) * (1.0 - t);
    let x =
        f64::from(animation.from) + (f64::from(animation.to) - f64::from(animation.from)) * eased;
    Frame::Move(x.round() as i32)
}

pub(crate) trait Surface {
    type Error;
    fn is_visible(&self) -> Result<bool, Self::Error>;
    fn geometry(&self) -> Result<Option<Geometry>, Self::Error>;
    fn set_size(&self, width: u32, height: u32) -> Result<(), Self::Error>;
    fn position(&self) -> Result<(i32, i32), Self::Error>;
    fn set_position(&self, x: i32, y: i32) -> Result<(), Self::Error>;
    fn show(&self) -> Result<(), Self::Error>;
    fn hide(&self) -> Result<(), Self::Error>;
    fn visibility(&self, visible: bool);
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Hidden,
    AwaitingPaint,
    Entering,
    Open,
    Exiting,
}

#[derive(Default)]
pub(crate) struct Coordinator {
    generation: u64,
    phase: Phase,
    geometry: Option<Geometry>,
    awaiting_reduced: bool,
}

impl Coordinator {
    fn next_generation(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    pub(crate) fn is_exiting(&self) -> bool {
        self.phase == Phase::Exiting
    }

    pub(crate) fn pending_paint(&self) -> Option<u64> {
        (self.phase == Phase::AwaitingPaint).then_some(self.generation)
    }

    pub(crate) fn show<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<Animation>, S::Error> {
        let visible = surface.is_visible()?;
        if visible && !self.is_exiting() {
            return Ok(None);
        }
        let generation = self.next_generation();
        if !visible {
            // A hidden webview may not have painted, even if it painted before
            // the previous hide. Park beyond the entire desktop while it warms.
            let Some(bounds) = surface.geometry()?.or(self.geometry) else {
                return Ok(None);
            };
            surface.set_size(bounds.width, bounds.height)?;
            surface.set_position(bounds.park_x, bounds.y)?;
            self.geometry = Some(bounds);
            surface.show()?;
            self.phase = Phase::AwaitingPaint;
            self.awaiting_reduced = reduced;
            surface.visibility(true);
            return Ok(None);
        }
        let (geometry, from) = (self.geometry, surface.position()?.0);
        if let Some(bounds) = geometry {
            if !reduced && from != bounds.x {
                self.phase = Phase::Entering;
                return Ok(Some(Animation {
                    generation,
                    from,
                    to: bounds.x,
                    y: bounds.y,
                    exit: false,
                }));
            }
            if visible && surface.position()? != (bounds.x, bounds.y) {
                surface.set_position(bounds.x, bounds.y)?;
            }
        }
        self.phase = Phase::Open;
        Ok(None)
    }

    pub(crate) fn painted<S: Surface>(
        &mut self,
        surface: &S,
        generation: u64,
    ) -> Result<Option<Animation>, S::Error> {
        if self.pending_paint() != Some(generation) {
            return Ok(None);
        }
        let Some(bounds) = self.geometry else {
            return Ok(None);
        };
        let x = if self.awaiting_reduced {
            bounds.x
        } else {
            bounds.offscreen_x
        };
        if surface.position()? != (x, bounds.y) {
            surface.set_position(x, bounds.y)?;
        }
        if !self.awaiting_reduced && x != bounds.x {
            self.phase = Phase::Entering;
            return Ok(Some(Animation {
                generation,
                from: x,
                to: bounds.x,
                y: bounds.y,
                exit: false,
            }));
        }
        self.phase = Phase::Open;
        Ok(None)
    }

    pub(crate) fn hide<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<Animation>, S::Error> {
        if !surface.is_visible()? || self.is_exiting() {
            return Ok(None);
        }
        let awaiting_paint = self.phase == Phase::AwaitingPaint;
        let generation = self.next_generation();
        if let Some(bounds) = self.geometry
            && !reduced
            && !awaiting_paint
        {
            let from = surface.position()?.0;
            self.phase = Phase::Exiting;
            return Ok(Some(Animation {
                generation,
                from,
                to: bounds.offscreen_x,
                y: bounds.y,
                exit: true,
            }));
        }
        self.finish_hide(surface)?;
        Ok(None)
    }

    pub(crate) fn toggle<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
        suppress_reopen: bool,
    ) -> Result<Option<Animation>, S::Error> {
        if surface.is_visible()? && !self.is_exiting() {
            self.hide(surface, reduced)
        } else if !suppress_reopen {
            self.show(surface, reduced)
        } else {
            Ok(None)
        }
    }

    pub(crate) fn advance<S: Surface>(
        &mut self,
        surface: &S,
        animation: &Animation,
        elapsed: Duration,
    ) -> Result<bool, S::Error> {
        match frame(animation, self.generation, elapsed) {
            Frame::Cancel => Ok(false),
            Frame::Move(x) => {
                surface.set_position(x, animation.y)?;
                Ok(true)
            }
            Frame::Finish(x) => {
                surface.set_position(x, animation.y)?;
                if animation.exit {
                    self.finish_hide(surface)?;
                } else {
                    self.phase = Phase::Open;
                    self.next_generation();
                }
                Ok(false)
            }
        }
    }

    fn finish_hide<S: Surface>(&mut self, surface: &S) -> Result<(), S::Error> {
        surface.hide()?;
        self.phase = Phase::Hidden;
        self.next_generation();
        // Do not move the hidden window while the compositor may still be
        // displaying its last frame. The next show positions it before showing.
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
