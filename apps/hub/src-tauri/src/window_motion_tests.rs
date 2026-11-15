use super::window_motion::{Animation, Coordinator, Frame, Geometry, Surface, frame};
use std::cell::{Cell, RefCell};
use std::time::Duration;

const GEOMETRY: Geometry = Geometry {
    x: 1307,
    y: 13,
    width: 600,
    height: 1014,
    offscreen_x: 1920,
};

struct FakeSurface {
    visible: Cell<bool>,
    position: Cell<(i32, i32)>,
    geometry: Cell<Option<Geometry>>,
    events: RefCell<Vec<String>>,
}

impl Default for FakeSurface {
    fn default() -> Self {
        Self {
            visible: Cell::new(false),
            position: Cell::new((0, 0)),
            geometry: Cell::new(Some(GEOMETRY)),
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
fn show_starts_beyond_work_area_before_showing_and_arrives_exactly() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = motion.show(&surface, false).unwrap().unwrap();
    assert_eq!(
        surface.events.borrow().as_slice(),
        ["size:600,1014", "position:1920,13", "show", "visible:true"]
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
fn exit_hides_offscreen_without_restoring_and_stale_frames_cannot_move_it() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = motion.show(&surface, false).unwrap().unwrap();
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
    assert_eq!(surface.position.get(), (1920, 13));
    let events = surface.events.borrow().clone();
    assert_eq!(
        &events[events.len() - 3..],
        ["position:1920,13", "hide", "visible:false"]
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
    let entry = motion.toggle(&surface, false, false).unwrap().unwrap();
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
    assert_eq!(surface.position.get(), (1920, 13));
}

#[test]
fn reduced_motion_shows_and_hides_in_place_without_frames() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, true).unwrap().is_none());
    assert_eq!(surface.position.get(), (1307, 13));
    assert!(surface.visible.get());
    assert!(motion.hide(&surface, true).unwrap().is_none());
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (1307, 13));
    assert_eq!(
        surface.events.borrow().as_slice(),
        [
            "size:600,1014",
            "position:1307,13",
            "show",
            "visible:true",
            "hide",
            "visible:false"
        ]
    );
}

#[test]
fn enabling_reduced_motion_during_entry_hides_in_place_and_cancels_frames() {
    let surface = FakeSurface::default();
    let mut motion = Coordinator::default();
    let entry = motion.show(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(100))
        .unwrap();
    assert!(motion.hide(&surface, true).unwrap().is_none());
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), (1460, 13));
    let events = surface.events.borrow().clone();
    assert_eq!(&events[events.len() - 2..], ["hide", "visible:false"]);
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
    let entry = motion.toggle(&surface, false, false).unwrap().unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let tray_exit = motion.toggle(&surface, false, false).unwrap().unwrap();
    motion
        .advance(&surface, &tray_exit, Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());

    let single_instance = motion.show(&surface, false).unwrap().unwrap();
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

    let entry = motion.toggle(&surface, false, false).unwrap().unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(200))
        .unwrap();
    let blur = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &blur, Duration::from_millis(200))
        .unwrap();
    assert!(!surface.visible.get());
    let entry = motion.show(&surface, false).unwrap().unwrap();
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
    for (index, _) in shows {
        assert_eq!(
            &events[index - 2..index],
            ["size:600,1014", "position:1920,13"]
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
    let entry = motion.show(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &entry, Duration::from_secs(1))
        .unwrap();
    let exit = motion.hide(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &exit, Duration::from_secs(1))
        .unwrap();
    surface.geometry.set(None);

    let start = surface.events.borrow().len();
    assert!(motion.show(&surface, true).unwrap().is_none());
    assert_eq!(surface.position.get(), (1307, 13));
    assert_eq!(
        &surface.events.borrow()[start..],
        ["size:600,1014", "position:1307,13", "show", "visible:true"]
    );
    assert!(motion.hide(&surface, true).unwrap().is_none());

    let start = surface.events.borrow().len();
    let entry = motion.toggle(&surface, false, false).unwrap().unwrap();
    assert_eq!(
        &surface.events.borrow()[start..],
        ["size:600,1014", "position:1920,13", "show", "visible:true"]
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
    let entry = motion.show(&surface, false).unwrap().unwrap();
    motion
        .advance(&surface, &entry, Duration::from_millis(100))
        .unwrap();
    let position = surface.position.get();
    motion.abort(&surface).unwrap();
    assert!(!surface.visible.get());
    assert_eq!(surface.position.get(), position);
    let events = surface.events.borrow().clone();
    assert_eq!(&events[events.len() - 2..], ["hide", "visible:false"]);
    assert!(
        !motion
            .advance(&surface, &entry, Duration::from_secs(1))
            .unwrap()
    );
    assert_eq!(*surface.events.borrow(), events);
}

#[test]
fn unavailable_monitor_falls_back_to_showing_and_hiding_without_movement() {
    let surface = FakeSurface {
        geometry: Cell::new(None),
        ..Default::default()
    };
    let mut motion = Coordinator::default();
    assert!(motion.show(&surface, false).unwrap().is_none());
    assert!(motion.hide(&surface, false).unwrap().is_none());
    assert_eq!(
        surface.events.borrow().as_slice(),
        ["show", "visible:true", "hide", "visible:false"]
    );
}
