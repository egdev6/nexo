use super::window_motion::{Animation, Coordinator, Frame, Geometry, Surface, frame};
use std::cell::{Cell, RefCell};
use std::time::Duration;

const GEOMETRY: Geometry = Geometry {
    x: 1307,
    y: 13,
    width: 600,
    height: 1014,
    offscreen_x: 1920,
    park_x: 2500,
};

struct FakeSurface {
    visible: Cell<bool>,
    position: Cell<(i32, i32)>,
    geometry: Cell<Option<Geometry>>,
    fail_cloak: Cell<bool>,
    fail_uncloak: Cell<bool>,
    events: RefCell<Vec<String>>,
}

impl Default for FakeSurface {
    fn default() -> Self {
        Self {
            visible: Cell::new(false),
            position: Cell::new((0, 0)),
            geometry: Cell::new(Some(GEOMETRY)),
            fail_cloak: Cell::new(false),
            fail_uncloak: Cell::new(false),
            events: RefCell::new(Vec::new()),
        }
    }
}
impl Surface for FakeSurface {
    type Error = ();
    fn is_visible(&self) -> Result<bool, Self::Error> {
        Ok(self.visible.get())
    }
    fn geometry(&self) -> Result<Option<Geometry>, Self::Error> {
        Ok(self.geometry.get())
    }
    fn set_size(&self, width: u32, height: u32) -> Result<(), Self::Error> {
        self.events
            .borrow_mut()
            .push(format!("size:{width},{height}"));
        Ok(())
    }
    fn position(&self) -> Result<(i32, i32), Self::Error> {
        Ok(self.position.get())
    }
    fn set_position(&self, x: i32, y: i32) -> Result<(), Self::Error> {
        self.position.set((x, y));
        self.events.borrow_mut().push(format!("position:{x},{y}"));
        Ok(())
    }
    fn set_cloaked(&self, cloaked: bool) -> Result<(), Self::Error> {
        self.events.borrow_mut().push(format!("cloak:{cloaked}"));
        if (cloaked && self.fail_cloak.get()) || (!cloaked && self.fail_uncloak.get()) {
            Err(())
        } else {
            Ok(())
        }
    }
    fn show(&self) -> Result<(), Self::Error> {
        self.visible.set(true);
        self.events.borrow_mut().push("show".into());
        Ok(())
    }
    fn hide(&self) -> Result<(), Self::Error> {
        self.visible.set(false);
        self.events.borrow_mut().push("hide".into());
        Ok(())
    }
    fn visibility(&self, visible: bool) {
        self.events.borrow_mut().push(format!("visible:{visible}"));
    }
}

fn show_painted(
    motion: &mut Coordinator,
    surface: &FakeSurface,
    reduced: bool,
) -> Option<Animation> {
    let animation = motion.show(surface, reduced).unwrap();
    match motion.pending_paint() {
        Some(generation) => motion.painted(surface, generation).unwrap(),
        None => animation,
    }
}

fn toggle_painted(
    motion: &mut Coordinator,
    surface: &FakeSurface,
    reduced: bool,
    suppress_reopen: bool,
) -> Option<Animation> {
    let previous = motion.pending_paint();
    let animation = motion.toggle(surface, reduced, suppress_reopen).unwrap();
    match motion.pending_paint().filter(|id| Some(*id) != previous) {
        Some(generation) => motion.painted(surface, generation).unwrap(),
        None => animation,
    }
}

#[test]
fn frame_eases_right_to_left_with_exact_endpoints_and_cancels_stale_generations() {
    let animation = Animation {
        generation: 7,
        from: 1920,
        to: 1307,
        y: 13,
        exit: false,
    };
    assert_eq!(frame(&animation, 6, Duration::ZERO), Frame::Cancel);
    assert_eq!(frame(&animation, 7, Duration::ZERO), Frame::Move(1920));
    assert_eq!(
        frame(&animation, 7, Duration::from_millis(100)),
        Frame::Move(1460)
    );
    assert_eq!(
        frame(&animation, 7, Duration::from_millis(200)),
        Frame::Finish(1307)
    );
    assert_eq!(
        frame(&animation, 7, Duration::from_secs(1)),
        Frame::Finish(1307)
    );
    let mut previous = animation.from;
    for ms in (0..200).step_by(16) {
        let Frame::Move(x) = frame(&animation, 7, Duration::from_millis(ms)) else {
            panic!("expected frame")
        };
        assert!((animation.to..=previous).contains(&x));
        previous = x;
    }
}

#[test]
fn entry_waits_for_webview_paint_before_starting_animation() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, false).unwrap().is_none());
    assert!(surface.visible.get());
    assert_eq!(surface.position.get(), (GEOMETRY.park_x, GEOMETRY.y));
    assert_eq!(
        surface.events.borrow().as_slice(),
        ["size:600,1014", "position:2500,13", "show", "visible:true"]
    );
    let generation = motion.pending_paint().unwrap();
    let entry = motion.painted(&surface, generation).unwrap().unwrap();
    assert_eq!((entry.from, entry.to), (1920, 1307));
    assert_eq!(surface.position.get(), (1920, 13));
}

#[test]
fn reduced_motion_waits_for_webview_paint_before_revealing() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, true).unwrap().is_none());
    assert!(surface.visible.get());
    assert_eq!(surface.position.get(), (GEOMETRY.park_x, GEOMETRY.y));
    let generation = motion.pending_paint().unwrap();
    assert!(motion.painted(&surface, generation).unwrap().is_none());
    assert_eq!(surface.position.get(), (GEOMETRY.x, GEOMETRY.y));
    assert_eq!(
        surface.events.borrow().as_slice(),
        [
            "size:600,1014",
            "position:2500,13",
            "show",
            "visible:true",
            "position:1307,13"
        ]
    );
}

#[test]
fn hiding_or_aborting_while_waiting_cancels_stale_paint_acknowledgements() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, false).unwrap().is_none());
    let first = motion.pending_paint().unwrap();
    assert!(motion.hide(&surface, false).unwrap().is_none());
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (2500, 13));
    let hidden_events = surface.events.borrow().clone();
    assert!(motion.painted(&surface, first).unwrap().is_none());
    assert_eq!(*surface.events.borrow(), hidden_events);

    assert!(motion.toggle(&surface, false, false).unwrap().is_none());
    let second = motion.pending_paint().unwrap();
    assert_ne!(first, second);
    let waiting_events = surface.events.borrow().clone();
    assert!(motion.painted(&surface, first).unwrap().is_none());
    assert_eq!(*surface.events.borrow(), waiting_events);
    let entry = motion.painted(&surface, second).unwrap().unwrap();
    let ready_events = surface.events.borrow().clone();
    assert!(motion.painted(&surface, second).unwrap().is_none());
    assert_eq!(*surface.events.borrow(), ready_events);
    motion.abort(&surface).unwrap();
    assert!(!surface.visible.get());
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_secs(1))
            .unwrap()
    );

    assert!(motion.show(&surface, false).unwrap().is_none());
    let third = motion.pending_paint().unwrap();
    motion.abort(&surface).unwrap();
    let aborted_events = surface.events.borrow().clone();
    assert!(motion.painted(&surface, third).unwrap().is_none());
    assert_eq!(*surface.events.borrow(), aborted_events);
}

#[test]
fn show_starts_beyond_work_area_before_showing_and_arrives_exactly() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    assert_eq!(
        surface.events.borrow().as_slice(),
        [
            "size:600,1014",
            "position:2500,13",
            "show",
            "visible:true",
            "position:1920,13"
        ]
    );
    assert!(
        motion
            .advance(&surface, &entry, Duration::from_millis(100))
            .unwrap()
    );
    assert_eq!(surface.position.get(), (1460, 13));
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_millis(200))
            .unwrap()
    );
    assert_eq!(surface.position.get(), (1307, 13));
    assert!(surface.visible.get());
}

#[test]
fn reopening_recomputes_flush_and_offscreen_positions_for_changed_work_area() {
    use super::position::{WorkArea, flyout_bounds, work_area_right_edge};

    fn geometry(area: &WorkArea, scale: f64) -> Geometry {
        let bounds = flyout_bounds(area, scale);
        Geometry {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            offscreen_x: work_area_right_edge(area),
            park_x: work_area_right_edge(area),
        }
    }

    let first = WorkArea {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    let second = WorkArea {
        x: -1920,
        y: 40,
        width: 1920,
        height: 1320,
    };
    let surface = FakeSurface::default();
    surface.geometry.set(Some(geometry(&first, 1.0)));
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    assert_eq!((entry.from, entry.to, entry.y), (1920, 1320, 0));
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    assert_eq!((exit.from, exit.to), (1320, 1920));
    motion
        .advance(&surface, &exit, Duration::from_secs(1))
        .unwrap();
    surface.geometry.set(Some(geometry(&second, 1.5)));
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    assert_eq!((entry.from, entry.to, entry.y), (0, -900, 40));
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    assert_eq!(surface.position.get(), (-900, 40));
    let events = surface.events.borrow();
    assert_eq!(
        &events[events.len() - 6..],
        [
            "size:900,1320",
            "position:0,40",
            "cloak:false",
            "show",
            "visible:true",
            "position:-900,40"
        ]
    );
    drop(events);
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    assert_eq!((exit.from, exit.to, exit.y), (-900, 0, 40));
}

#[test]
fn exit_hides_without_restoring_and_stale_frames_cannot_move_it() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    assert!(surface.visible.get());
    assert!(
        motion
            .advance(&surface, &exit, Duration::from_millis(100))
            .unwrap()
    );
    assert!(
        !motion
            .advance(&surface, &exit, Duration::from_millis(200))
            .unwrap()
    );
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (1767, 13));
    let events = surface.events.borrow().clone();
    assert_eq!(
        &events[events.len() - 3..],
        ["cloak:true", "hide", "visible:false"]
    );
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_secs(1))
            .unwrap()
    );
    assert!(
        !motion
            .advance(&surface, &exit, Duration::from_secs(1))
            .unwrap()
    );
    assert_eq!(*surface.events.borrow(), events);
}

#[test]
fn reopening_during_exit_and_double_click_cancel_only_obsolete_frames() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = toggle_painted(&mut motion, &surface, false, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let exit = motion.toggle(&surface, false, false).unwrap().unwrap();
    motion
        .advance(&surface, &exit, Duration::from_millis(100))
        .unwrap();
    let midway = surface.position.get();
    assert!(motion.toggle(&surface, false, true).unwrap().is_none());
    assert!(motion.hide(&surface, false).unwrap().is_none());
    let reopened = motion.toggle(&surface, false, false).unwrap().unwrap();
    assert_eq!(surface.position.get(), midway);
    assert!(
        !motion
            .advance(&surface, &exit, Duration::from_secs(1))
            .unwrap()
    );
    assert!(surface.visible.get());
    let second_exit = motion.toggle(&surface, false, false).unwrap().unwrap();
    assert!(
        !motion
            .advance(&surface, &reopened, Duration::from_secs(1))
            .unwrap()
    );
    motion
        .advance(&surface, &second_exit, Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), midway);
}

#[test]
fn reduced_motion_shows_and_hides_in_place_without_frames() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert!(show_painted(&mut motion, &surface, true).is_none());
    assert_eq!(surface.position.get(), (1307, 13));
    assert!(surface.visible.get());
    assert!(motion.hide(&surface, true).unwrap().is_none());
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (1307, 13));
    assert_eq!(
        surface.events.borrow().as_slice(),
        [
            "size:600,1014",
            "position:2500,13",
            "show",
            "visible:true",
            "position:1307,13",
            "cloak:true",
            "hide",
            "visible:false"
        ]
    );
}

#[test]
fn enabling_reduced_motion_during_entry_hides_in_place_and_cancels_frames() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(100))
        .unwrap();
    assert!(motion.hide(&surface, true).unwrap().is_none());
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (1460, 13));
    let events = surface.events.borrow().clone();
    assert_eq!(
        &events[events.len() - 3..],
        ["cloak:true", "hide", "visible:false"]
    );
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_secs(1))
            .unwrap()
    );
    assert_eq!(*surface.events.borrow(), events);
}

#[test]
fn tray_single_instance_close_and_blur_preserve_hide_to_tray_and_reopen() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = toggle_painted(&mut motion, &surface, false, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let tray_exit = motion.toggle(&surface, false, false).unwrap().unwrap();
    motion
        .advance(&surface, &tray_exit, Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());

    let single_instance = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &single_instance, Duration::from_millis(200))
        .unwrap();
    let prevented = Cell::new(false);
    let mut close_exit = None;
    super::handle_close_request(
        "main",
        || prevented.set(true),
        || {
            close_exit = motion.hide(&surface, false)?;
            Ok::<_, ()>(())
        },
    )
    .unwrap();
    assert!(prevented.get());
    assert!(surface.visible.get());
    motion
        .advance(&surface, &close_exit.unwrap(), Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());

    let entry = toggle_painted(&mut motion, &surface, false, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let blur = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &blur, Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    assert!(surface.visible.get());
    assert_eq!(surface.position.get(), (1307, 13));
    let events = surface.events.borrow();
    let shows: Vec<_> = events
        .iter()
        .enumerate()
        .filter(|(_, event)| *event == "show")
        .collect();
    assert_eq!(shows.len(), 4);
    assert_eq!(
        &events[shows[0].0 - 2..shows[0].0],
        ["size:600,1014", "position:2500,13"]
    );
    for (index, _) in shows.into_iter().skip(1) {
        assert_eq!(
            &events[index - 3..index],
            ["size:600,1014", "position:2500,13", "cloak:false"]
        );
    }
    assert_eq!(
        events
            .iter()
            .filter(|event| *event == "visible:true")
            .count(),
        4
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| *event == "visible:false")
            .count(),
        3
    );
}

#[test]
fn reopen_positions_before_show_even_if_monitor_temporarily_disappears() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &exit, Duration::from_secs(1))
        .unwrap();
    surface.geometry.set(None);

    let start = surface.events.borrow().len();
    assert!(show_painted(&mut motion, &surface, true).is_none());
    assert_eq!(surface.position.get(), (1307, 13));
    assert_eq!(
        &surface.events.borrow()[start..],
        [
            "size:600,1014",
            "position:2500,13",
            "cloak:false",
            "show",
            "visible:true",
            "position:1307,13"
        ]
    );
    assert!(motion.hide(&surface, true).unwrap().is_none());

    let start = surface.events.borrow().len();
    let entry = toggle_painted(&mut motion, &surface, false, false).unwrap();
    assert_eq!(
        &surface.events.borrow()[start..],
        [
            "size:600,1014",
            "position:2500,13",
            "cloak:false",
            "show",
            "visible:true",
            "position:1920,13"
        ]
    );
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    assert_eq!(surface.position.get(), (1307, 13));
}

#[test]
fn abort_hides_in_place_without_moving_after_hide() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(100))
        .unwrap();
    let position = surface.position.get();
    motion.abort(&surface).unwrap();
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), position);
    let events = surface.events.borrow().clone();
    assert_eq!(
        &events[events.len() - 3..],
        ["cloak:true", "hide", "visible:false"]
    );
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_secs(1))
            .unwrap()
    );
    assert_eq!(*surface.events.borrow(), events);
}

#[test]
fn exit_cloaks_before_hiding_without_moving_the_last_visible_frame() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &exit, Duration::from_millis(100))
        .unwrap();
    let last_visible_position = surface.position.get();
    let before_finish = surface.events.borrow().len();
    assert!(
        !motion
            .advance(&surface, &exit, Duration::from_millis(200))
            .unwrap()
    );
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), last_visible_position);
    assert_eq!(
        &surface.events.borrow()[before_finish..],
        ["cloak:true", "hide", "visible:false"]
    );
}

#[test]
fn reduced_and_aborted_hides_also_cloak_before_hiding() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    show_painted(&mut motion, &surface, true);
    let before_hide = surface.events.borrow().len();
    motion.hide(&surface, true).unwrap();
    assert_eq!(
        &surface.events.borrow()[before_hide..],
        ["cloak:true", "hide", "visible:false"]
    );
    show_painted(&mut motion, &surface, false);
    let before_abort = surface.events.borrow().len();
    motion.abort(&surface).unwrap();
    assert_eq!(
        &surface.events.borrow()[before_abort..],
        ["cloak:true", "hide", "visible:false"]
    );
}

#[test]
fn reopen_uncloaks_only_after_parking_and_before_show_and_paint() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    show_painted(&mut motion, &surface, true);
    motion.hide(&surface, true).unwrap();
    let before_reopen = surface.events.borrow().len();
    assert!(motion.show(&surface, false).unwrap().is_none());
    assert_eq!(
        &surface.events.borrow()[before_reopen..],
        [
            "size:600,1014",
            "position:2500,13",
            "cloak:false",
            "show",
            "visible:true"
        ]
    );
    assert_eq!(surface.position.get(), (GEOMETRY.park_x, GEOMETRY.y));
    let generation = motion.pending_paint().unwrap();
    let entry = motion.painted(&surface, generation).unwrap().unwrap();
    assert_eq!((entry.from, entry.to), (GEOMETRY.offscreen_x, GEOMETRY.x));
}

#[test]
fn failed_cloak_still_hides_and_does_not_require_uncloaking() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    show_painted(&mut motion, &surface, true);
    surface.fail_cloak.set(true);
    let before_hide = surface.events.borrow().len();
    motion.hide(&surface, true).unwrap();
    assert!(!surface.visible.get());
    assert_eq!(
        &surface.events.borrow()[before_hide..],
        ["cloak:true", "hide", "visible:false"]
    );
    let before_show = surface.events.borrow().len();
    motion.show(&surface, false).unwrap();
    assert_eq!(
        &surface.events.borrow()[before_show..],
        ["size:600,1014", "position:2500,13", "show", "visible:true"]
    );
}

#[test]
fn failed_uncloak_never_shows_a_cloaked_window_and_can_be_retried() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    show_painted(&mut motion, &surface, true);
    motion.hide(&surface, true).unwrap();
    surface.fail_uncloak.set(true);
    let before_show = surface.events.borrow().len();
    assert!(motion.show(&surface, false).is_err());
    assert!(!surface.visible.get());
    assert!(motion.pending_paint().is_none());
    assert_eq!(
        &surface.events.borrow()[before_show..],
        ["size:600,1014", "position:2500,13", "cloak:false"]
    );
    surface.fail_uncloak.set(false);
    let before_retry = surface.events.borrow().len();
    assert!(motion.show(&surface, false).unwrap().is_none());
    assert_eq!(
        &surface.events.borrow()[before_retry..],
        [
            "size:600,1014",
            "position:2500,13",
            "cloak:false",
            "show",
            "visible:true"
        ]
    );
    assert!(motion.pending_paint().is_some());
}

#[test]
fn cancelled_exit_never_cloaks_or_hides_the_reopened_surface() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = show_painted(&mut motion, &surface, false).unwrap();
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &exit, Duration::from_millis(100))
        .unwrap();
    let reopened = motion.show(&surface, false).unwrap().unwrap();
    let before_stale = surface.events.borrow().len();
    assert!(
        !motion
            .advance(&surface, &exit, Duration::from_secs(1))
            .unwrap()
    );
    assert_eq!(surface.events.borrow().len(), before_stale);
    assert!(surface.visible.get());
    motion
        .advance(&surface, &reopened, Duration::from_secs(1))
        .unwrap();
    assert_eq!(surface.position.get(), (GEOMETRY.x, GEOMETRY.y));
}

#[test]
fn unavailable_monitor_does_not_reveal_an_unpainted_window() {
    let surface = FakeSurface {
        geometry: Cell::new(None),
        ..Default::default()
    };
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, false).unwrap().is_none());
    assert!(motion.hide(&surface, false).unwrap().is_none());
    assert!(!surface.visible.get());
    assert!(motion.pending_paint().is_none());
    assert!(surface.events.borrow().is_empty());
}
