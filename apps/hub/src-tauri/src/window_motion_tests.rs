use super::window_motion::{Coordinator, Geometry, MotionSnapshot, Surface, TIMEOUT};
use std::cell::{Cell, RefCell};
use std::time::Duration;

const GEOMETRY: Geometry = Geometry {
    x: 1307,
    y: 13,
    width: 600,
    height: 1014,
};

struct FakeSurface {
    visible: Cell<bool>,
    geometry: Cell<Option<Geometry>>,
    fail_cloak: Cell<bool>,
    fail_uncloak: Cell<bool>,
    events: RefCell<Vec<String>>,
}
impl Default for FakeSurface {
    fn default() -> Self {
        Self {
            visible: Cell::new(false),
            geometry: Cell::new(Some(GEOMETRY)),
            fail_cloak: Cell::new(false),
            fail_uncloak: Cell::new(false),
            events: RefCell::new(Vec::new()),
        }
    }
}
impl FakeSurface {
    fn event(&self, event: impl Into<String>) {
        self.events.borrow_mut().push(event.into());
    }
}
impl Surface for FakeSurface {
    type Error = ();
    fn is_visible(&self) -> Result<bool, ()> {
        Ok(self.visible.get())
    }
    fn geometry(&self) -> Result<Option<Geometry>, ()> {
        Ok(self.geometry.get())
    }
    fn set_size(&self, width: u32, height: u32) -> Result<(), ()> {
        self.event(format!("size:{width},{height}"));
        Ok(())
    }
    fn set_position(&self, x: i32, y: i32) -> Result<(), ()> {
        self.event(format!("position:{x},{y}"));
        Ok(())
    }
    fn set_cloaked(&self, cloaked: bool) -> Result<(), ()> {
        self.event(format!("cloak:{cloaked}"));
        if (cloaked && self.fail_cloak.get()) || (!cloaked && self.fail_uncloak.get()) {
            Err(())
        } else {
            Ok(())
        }
    }
    fn show(&self) -> Result<(), ()> {
        self.visible.set(true);
        self.event("show");
        Ok(())
    }
    fn hide(&self) -> Result<(), ()> {
        self.visible.set(false);
        self.event("hide");
        Ok(())
    }
    fn visibility(&self, visible: bool) {
        self.event(format!("visible:{visible}"));
    }
    fn motion(&self, snapshot: MotionSnapshot) {
        self.event(format!("motion:{:?}", snapshot.phase));
    }
}

fn entry(motion: &mut Coordinator, surface: &FakeSurface) -> u64 {
    assert_eq!(motion.show(surface, false), Ok(None));
    let generation = motion.pending_paint().unwrap();
    assert_eq!(motion.painted(surface, generation), Ok(Some(generation)));
    generation
}
fn open(motion: &mut Coordinator, surface: &FakeSurface) {
    let generation = entry(motion, surface);
    motion.finish(surface, generation).unwrap();
}

#[test]
fn entry_shows_at_final_bounds_then_waits_for_paint_and_ack() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert_eq!(motion.show(&surface, false), Ok(None));
    assert_eq!(
        *surface.events.borrow(),
        [
            "size:600,1014",
            "position:1307,13",
            "motion:Waiting",
            "show",
            "visible:true"
        ]
    );
    let generation = motion.pending_paint().unwrap();
    assert_eq!(motion.painted(&surface, generation), Ok(Some(generation)));
    assert_eq!(surface.events.borrow().last().unwrap(), "motion:Entering");
    motion.finish(&surface, generation).unwrap();
    assert_eq!(&surface.events.borrow()[6..], ["motion:Open"]);
    assert!(
        !surface
            .events
            .borrow()
            .iter()
            .any(|event| event.starts_with("backdrop:"))
    );
    assert!(surface.visible.get());
}

#[test]
fn focus_changes_leave_the_open_flyout_and_motion_untouched() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let before = surface.events.borrow().clone();
    let snapshot = motion.snapshot();
    for focused in [false, true] {
        let prevented = Cell::new(false);
        let result = super::handle_window_event(
            "main",
            &tauri::WindowEvent::Focused(focused),
            || prevented.set(true),
            || {
                motion.hide(&surface, false)?;
                Ok::<_, ()>(())
            },
        );
        assert_eq!(result, Ok(()));
        assert!(!prevented.get());
        assert!(surface.visible.get());
        assert_eq!(*surface.events.borrow(), before);
        assert_eq!(motion.snapshot().phase, snapshot.phase);
        assert_eq!(motion.snapshot().generation, snapshot.generation);
        assert_eq!(motion.snapshot().sequence, snapshot.sequence);
    }
}

#[test]
fn tray_click_hides_then_next_click_shows_without_a_blur_suppression() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let before = surface.events.borrow().len();
    let exit = motion.toggle(&surface, false).unwrap().unwrap();
    assert_eq!(&surface.events.borrow()[before..], ["motion:Exiting"]);
    assert!(surface.visible.get());
    motion.finish(&surface, exit).unwrap();
    assert!(!surface.visible.get());
    let before_reopen = surface.events.borrow().len();
    assert_eq!(motion.toggle(&surface, false), Ok(None));
    assert!(surface.visible.get());
    assert_eq!(
        &surface.events.borrow()[before_reopen..],
        [
            "size:600,1014",
            "position:1307,13",
            "cloak:false",
            "motion:Waiting",
            "show",
            "visible:true"
        ]
    );
}

#[test]
fn exit_ack_cloaks_and_hides_without_moving_or_touching_a_backdrop() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let before = surface.events.borrow().len();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    assert_eq!(&surface.events.borrow()[before..], ["motion:Exiting"]);
    assert!(surface.visible.get());
    motion.finish(&surface, exit).unwrap();
    assert_eq!(
        &surface.events.borrow()[before..],
        [
            "motion:Exiting",
            "cloak:true",
            "hide",
            "motion:Hidden",
            "visible:false"
        ]
    );
    assert!(!surface.visible.get());
}

#[test]
fn timeout_uses_the_same_completion_path_for_entry_and_exit() {
    assert_eq!(TIMEOUT, Duration::from_millis(400));
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let id = entry(&mut motion, &surface);
    motion.finish(&surface, id).unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion.finish(&surface, exit).unwrap();
    assert!(!surface.visible.get());
    assert!(
        !surface
            .events
            .borrow()
            .iter()
            .any(|event| event.starts_with("backdrop:"))
    );
}

#[test]
fn reopening_and_double_clicks_cancel_stale_exit_and_entry_acknowledgements() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let exit = motion.toggle(&surface, false).unwrap().unwrap();
    assert_eq!(motion.hide(&surface, false), Ok(None));
    let reopened = motion.toggle(&surface, false).unwrap().unwrap();
    let before = surface.events.borrow().len();
    motion.finish(&surface, exit).unwrap();
    assert_eq!(surface.events.borrow().len(), before);
    let second_exit = motion.toggle(&surface, false).unwrap().unwrap();
    motion.finish(&surface, reopened).unwrap();
    assert!(surface.visible.get());
    motion.finish(&surface, second_exit).unwrap();
    assert!(!surface.visible.get());
}

#[test]
fn reduced_motion_shows_and_hides_in_place_without_clearing_or_sliding() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert_eq!(motion.show(&surface, true), Ok(None));
    let id = motion.pending_paint().unwrap();
    assert_eq!(motion.painted(&surface, id), Ok(None));
    assert_eq!(motion.hide(&surface, true), Ok(None));
    assert_eq!(
        *surface.events.borrow(),
        [
            "size:600,1014",
            "position:1307,13",
            "motion:Waiting",
            "show",
            "visible:true",
            "motion:Open",
            "cloak:true",
            "hide",
            "motion:Hidden",
            "visible:false"
        ]
    );
}

#[test]
fn reduced_reopen_uncloaks_and_shows_without_a_backdrop() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion.finish(&surface, exit).unwrap();
    let before = surface.events.borrow().len();
    motion.show(&surface, true).unwrap();
    assert_eq!(
        &surface.events.borrow()[before..],
        [
            "size:600,1014",
            "position:1307,13",
            "cloak:false",
            "motion:Waiting",
            "show",
            "visible:true"
        ]
    );
}

#[test]
fn hide_or_abort_during_paint_cancels_stale_probes() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    motion.show(&surface, false).unwrap();
    let old = motion.pending_paint().unwrap();
    motion.hide(&surface, false).unwrap();
    let events = surface.events.borrow().clone();
    assert_eq!(motion.painted(&surface, old), Ok(None));
    assert_eq!(*surface.events.borrow(), events);
    motion.show(&surface, false).unwrap();
    let next = motion.pending_paint().unwrap();
    motion.abort(&surface).unwrap();
    assert_eq!(motion.painted(&surface, next), Ok(None));
    assert!(!surface.visible.get());
}

#[test]
fn tray_close_and_single_instance_keep_hide_to_tray_and_reopen() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    let exit = motion.toggle(&surface, false).unwrap().unwrap();
    motion.finish(&surface, exit).unwrap();
    open(&mut motion, &surface);
    let prevented = Cell::new(false);
    let mut exit = None;
    super::handle_close_request(
        "main",
        || prevented.set(true),
        || {
            exit = motion.hide(&surface, false)?;
            Ok::<_, ()>(())
        },
    )
    .unwrap();
    assert!(prevented.get());
    motion.finish(&surface, exit.unwrap()).unwrap();
    open(&mut motion, &surface);
    assert!(surface.visible.get());
    assert_eq!(
        surface
            .events
            .borrow()
            .iter()
            .filter(|e| *e == "visible:true")
            .count(),
        3
    );
    assert_eq!(
        surface
            .events
            .borrow()
            .iter()
            .filter(|e| *e == "visible:false")
            .count(),
        2
    );
}

#[test]
fn reopen_uses_new_or_cached_geometry_before_uncloak_and_show() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    motion.hide(&surface, true).unwrap();
    surface.geometry.set(Some(Geometry {
        x: -900,
        y: 40,
        width: 900,
        height: 1320,
    }));
    let before = surface.events.borrow().len();
    motion.show(&surface, true).unwrap();
    assert_eq!(
        &surface.events.borrow()[before..],
        [
            "size:900,1320",
            "position:-900,40",
            "cloak:false",
            "motion:Waiting",
            "show",
            "visible:true"
        ]
    );
    motion.hide(&surface, true).unwrap();
    surface.geometry.set(None);
    let before = surface.events.borrow().len();
    motion.show(&surface, true).unwrap();
    assert_eq!(
        &surface.events.borrow()[before..],
        [
            "size:900,1320",
            "position:-900,40",
            "cloak:false",
            "motion:Waiting",
            "show",
            "visible:true"
        ]
    );
}

#[test]
fn cloak_failure_still_hides_and_uncloak_failure_prevents_show_until_retry() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    open(&mut motion, &surface);
    surface.fail_cloak.set(true);
    motion.hide(&surface, true).unwrap();
    assert!(!surface.visible.get());
    surface.fail_cloak.set(false);
    motion.show(&surface, true).unwrap();
    motion.hide(&surface, true).unwrap();
    surface.fail_uncloak.set(true);
    assert!(motion.show(&surface, true).is_err());
    assert!(!surface.visible.get());
    surface.fail_uncloak.set(false);
    motion.show(&surface, true).unwrap();
    assert!(surface.visible.get());
}

#[test]
fn main_window_uses_transparency_without_native_effects_or_redirection() {
    let source = include_str!("lib.rs");
    assert!(source.contains(".no_redirection_bitmap(true)"));
    assert!(source.contains(".shadow(false)"));
    assert!(source.contains("window_effects = None"));
    assert!(source.contains("create = false"));
    assert!(!source.contains("window_vibrancy::"));
}

#[test]
fn manual_main_window_keeps_configured_flags_and_removes_effects() {
    let mut config: tauri::Config =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut expected = config
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .unwrap()
        .clone();
    assert!(expected.create);
    assert!(expected.window_effects.is_some());
    expected.create = false;
    expected.window_effects = None;
    super::prepare_main_window(&mut config).unwrap();
    let actual = config
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .unwrap();
    assert_eq!(
        serde_json::to_value(actual).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    config.app.windows.clear();
    assert!(super::prepare_main_window(&mut config).is_err());
}

#[test]
fn unavailable_monitor_never_shows() {
    let surface = FakeSurface {
        geometry: Cell::new(None),
        ..Default::default()
    };
    let mut motion = Coordinator::default();
    assert_eq!(motion.show(&surface, false), Ok(None));
    assert!(!surface.visible.get());
    assert!(surface.events.borrow().is_empty());
}
