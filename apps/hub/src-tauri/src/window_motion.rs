use std::time::Duration;

pub(crate) const DURATION: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub offscreen_x: i32,
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
    Entering,
    Open,
    Exiting,
}

#[derive(Default)]
pub(crate) struct Coordinator {
    generation: u64,
    phase: Phase,
    geometry: Option<Geometry>,
}

impl Coordinator {
    fn next_generation(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    pub(crate) fn is_exiting(&self) -> bool {
        self.phase == Phase::Exiting
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
        let (geometry, from) = if visible {
            (self.geometry, surface.position()?.0)
        } else {
            // A previously hidden window may still be offscreen if monitor data
            // is temporarily unavailable. Keep the last usable placement.
            let geometry = surface.geometry()?.or(self.geometry);
            if let Some(bounds) = geometry {
                surface.set_size(bounds.width, bounds.height)?;
                surface.set_position(
                    if reduced {
                        bounds.x
                    } else {
                        bounds.offscreen_x
                    },
                    bounds.y,
                )?;
            }
            self.geometry = geometry;
            surface.show()?;
            surface.visibility(true);
            (
                geometry,
                geometry.map_or(0, |bounds| {
                    if reduced {
                        bounds.x
                    } else {
                        bounds.offscreen_x
                    }
                }),
            )
        };
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

    pub(crate) fn hide<S: Surface>(
        &mut self,
        surface: &S,
        reduced: bool,
    ) -> Result<Option<Animation>, S::Error> {
        if !surface.is_visible()? || self.is_exiting() {
            return Ok(None);
        }
        let generation = self.next_generation();
        if let Some(bounds) = self.geometry
            && !reduced
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
