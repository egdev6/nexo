#[derive(Debug, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct FlyoutBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn work_area_right_edge(area: &WorkArea) -> i32 {
    (i64::from(area.x) + i64::from(area.width)).clamp(i64::from(i32::MIN), i64::from(i32::MAX))
        as i32
}

pub fn flyout_bounds(area: &WorkArea, scale: f64) -> FlyoutBounds {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let width = ((600.0 * scale).round() as u32).max(1).min(area.width);
    let x = i64::from(area.x) + i64::from(area.width) - i64::from(width);
    FlyoutBounds {
        x: x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: area.y,
        width,
        height: area.height,
    }
}

#[cfg(test)]
mod tests {
    use super::{FlyoutBounds, WorkArea, flyout_bounds, work_area_right_edge};

    #[test]
    fn right_edge_respects_negative_origins_and_saturates() {
        let mut area = WorkArea {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1320,
        };
        assert_eq!(work_area_right_edge(&area), 0);
        area.x = i32::MAX - 1;
        area.width = 1920;
        assert_eq!(work_area_right_edge(&area), i32::MAX);
    }

    #[test]
    fn fills_work_area_height_independent_of_content() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        assert_eq!(
            flyout_bounds(&area, 1.0),
            FlyoutBounds {
                x: 1320,
                y: 0,
                width: 600,
                height: 1040
            }
        );
    }

    #[test]
    fn scales_logical_dimensions_and_preserves_negative_monitor_origins() {
        let area = WorkArea {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1320,
        };
        assert_eq!(
            flyout_bounds(&area, 1.5),
            FlyoutBounds {
                x: -900,
                y: 40,
                width: 900,
                height: 1320
            }
        );
    }

    #[test]
    fn falls_back_to_unit_scale_and_handles_a_zero_sized_area() {
        let area = WorkArea {
            x: -30,
            y: 20,
            width: 800,
            height: 600,
        };
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                flyout_bounds(&area, scale),
                FlyoutBounds {
                    x: 170,
                    y: 20,
                    width: 600,
                    height: 600
                }
            );
        }
        let empty = WorkArea {
            x: 100,
            y: -50,
            width: 0,
            height: 0,
        };
        assert_eq!(
            flyout_bounds(&empty, 1.0),
            FlyoutBounds {
                x: 100,
                y: -50,
                width: 0,
                height: 0
            }
        );
    }

    #[test]
    fn constrains_both_dimensions_to_a_small_work_area() {
        let area = WorkArea {
            x: 100,
            y: -50,
            width: 500,
            height: 300,
        };
        assert_eq!(
            flyout_bounds(&area, 1.0),
            FlyoutBounds {
                x: 100,
                y: -50,
                width: 500,
                height: 300
            }
        );
    }
}
