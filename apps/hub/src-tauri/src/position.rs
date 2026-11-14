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

pub fn flyout_bounds(area: &WorkArea, scale: f64, content_height: f64) -> FlyoutBounds {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let margin = (12.8 * scale).round() as u32;
    let margin_x = margin.min(area.width.saturating_sub(1) / 2);
    let margin_y = margin.min(area.height.saturating_sub(1) / 2);
    let available_width = area.width.saturating_sub(margin_x * 2).max(1);
    let available_height = area.height.saturating_sub(margin_y * 2).max(1);
    let content_height = if content_height.is_finite() {
        content_height.clamp(1.0, 820.0)
    } else {
        820.0
    };
    let width = ((600.0 * scale).round() as u32).max(1).min(available_width);
    let height = ((content_height * scale).round() as u32)
        .max(1)
        .min(available_height);
    let x = i64::from(area.x) + i64::from(area.width) - i64::from(margin_x) - i64::from(width);
    let y = i64::from(area.y) + i64::from(area.height) - i64::from(margin_y) - i64::from(height);
    FlyoutBounds {
        x: x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::{FlyoutBounds, WorkArea, flyout_bounds};

    #[test]
    fn caps_height_and_anchors_to_work_area() {
        let area = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        assert_eq!(
            flyout_bounds(&area, 1.0, 1200.0),
            FlyoutBounds {
                x: 1307,
                y: 207,
                width: 600,
                height: 820
            }
        );
        assert_eq!(
            flyout_bounds(&area, 1.0, 350.0),
            FlyoutBounds {
                x: 1307,
                y: 677,
                width: 600,
                height: 350
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
            flyout_bounds(&area, 1.5, 600.0),
            FlyoutBounds {
                x: -919,
                y: 441,
                width: 900,
                height: 900
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
            flyout_bounds(&area, 1.0, 820.0),
            FlyoutBounds {
                x: 113,
                y: -37,
                width: 474,
                height: 274
            }
        );
    }
}
