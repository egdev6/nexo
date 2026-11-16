//! Physical geometry and settings for the independent Windows content backdrop.
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Clip {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
    pub content_width: u32,
    pub content_height: u32,
}

impl Clip {
    pub(crate) fn validate(&self) -> Result<(), String> {
        const MAX: u32 = 1_000_000;
        if self.width == 0
            || self.height == 0
            || self.width > MAX
            || self.height > MAX
            || self.y == 0
            || self.content_width == 0
            || self.content_height == 0
            || self
                .x
                .checked_add(self.content_width)
                .is_none_or(|right| right > self.width)
            || self
                .y
                .checked_add(self.content_height)
                .is_none_or(|bottom| bottom > self.height)
        {
            return Err("Invalid content backdrop geometry".into());
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GeometryMatch {
    Current,
    Stale,
    UnexpectedFrame,
}

pub(crate) fn geometry_match(
    clip: &Clip,
    client: (u32, u32),
    outer: (u32, u32),
    visible: bool,
) -> GeometryMatch {
    if visible && client != outer {
        return GeometryMatch::UnexpectedFrame;
    }
    let actual = if visible { client } else { outer };
    if (clip.width, clip.height) == actual {
        GeometryMatch::Current
    } else {
        GeometryMatch::Stale
    }
}

pub(crate) fn may_create_layer(label: &str, closing: bool) -> bool {
    label == "main" && !closing
}

pub(crate) fn physical_sigma(blur: u8, opacity: u8, scale: f64) -> Result<Option<f32>, String> {
    if blur > 40 || opacity > 100 || !scale.is_finite() || scale <= 0.0 {
        return Err("Invalid backdrop settings or DPI".into());
    }
    if blur == 0 || opacity == 100 {
        return Ok(None);
    }
    let sigma = (f64::from(blur) * scale) as f32;
    if !sigma.is_finite() || sigma <= 0.0 {
        return Err("Invalid backdrop settings or DPI".into());
    }
    Ok(Some(sigma))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip() -> Clip {
        Clip {
            width: 600,
            height: 1000,
            x: 0,
            y: 175,
            content_width: 600,
            content_height: 825,
        }
    }

    #[test]
    fn accepts_physical_content_geometry_and_camel_case_ipc() {
        let from_ipc: Clip = serde_json::from_str(
            r#"{"width":600,"height":1000,"x":0,"y":175,"contentWidth":600,"contentHeight":825}"#,
        )
        .unwrap();
        assert_eq!(from_ipc, clip());
        assert_eq!(from_ipc.validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_unbounded_or_outside_content_without_overflow() {
        for bad in [
            Clip { width: 0, ..clip() },
            Clip {
                height: 1_000_001,
                ..clip()
            },
            Clip {
                content_width: 0,
                ..clip()
            },
            Clip {
                content_height: 0,
                ..clip()
            },
            Clip {
                y: 0,
                content_height: 1000,
                ..clip()
            },
            Clip { x: 1, ..clip() },
            Clip { y: 176, ..clip() },
            Clip {
                x: u32::MAX,
                ..clip()
            },
            Clip {
                y: u32::MAX,
                ..clip()
            },
        ] {
            assert!(bad.validate().is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn hidden_provisional_client_is_allowed_but_shown_frames_and_stale_sizes_are_not() {
        let shape = clip();
        assert_eq!(
            geometry_match(&shape, (580, 950), (600, 1000), false),
            GeometryMatch::Current
        );
        assert_eq!(
            geometry_match(&shape, (600, 1000), (600, 1000), true),
            GeometryMatch::Current
        );
        assert_eq!(
            geometry_match(&shape, (601, 1000), (601, 1000), true),
            GeometryMatch::Stale
        );
        assert_eq!(
            geometry_match(&shape, (580, 950), (600, 1000), true),
            GeometryMatch::UnexpectedFrame
        );
        assert_eq!(
            geometry_match(&shape, (580, 950), (601, 1000), false),
            GeometryMatch::Stale
        );
    }

    #[test]
    fn only_main_can_create_a_layer_and_never_during_shutdown() {
        assert!(may_create_layer("main", false));
        assert!(!may_create_layer("main", true));
        for label in ["widget", "detail", "settings", "", "arbitrary-hwnd"] {
            assert!(!may_create_layer(label, false));
        }
    }

    #[test]
    fn settings_map_css_blur_to_physical_sigma_and_disable_invisible_blur() {
        assert_eq!(physical_sigma(0, 60, 1.25), Ok(None));
        assert_eq!(physical_sigma(40, 100, 1.25), Ok(None));
        for (blur, scale, expected) in [
            (1, 1.0, 1.0),
            (12, 1.25, 15.0),
            (40, 1.5, 60.0),
            (12, 1.25, 15.0),
        ] {
            assert_eq!(physical_sigma(blur, 60, scale), Ok(Some(expected)));
        }
        for (blur, opacity, scale) in [
            (41, 60, 1.0),
            (1, 101, 1.0),
            (1, 60, 0.0),
            (1, 60, -1.0),
            (1, 60, f64::NAN),
            (1, 60, f64::INFINITY),
            (1, 60, f64::MAX),
            (1, 60, f64::MIN_POSITIVE),
        ] {
            assert!(physical_sigma(blur, opacity, scale).is_err());
        }
    }
}
