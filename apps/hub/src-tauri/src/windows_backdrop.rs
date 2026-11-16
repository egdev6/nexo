//! Windows composition owned entirely by the UI thread. Never apply an HWND-wide backdrop.
use crate::window_clip::{self, Clip, GeometryMatch};
use std::{
    cell::{Cell, RefCell},
    mem::size_of,
    sync::atomic::{AtomicU32, AtomicUsize, Ordering},
    time::{Duration, Instant},
};
use tauri::{WebviewWindow, Window, WindowEvent};
use windows::{
    System::{DispatcherQueue, DispatcherQueueController},
    UI::Composition::{
        CompositionBackdropBrush, CompositionEffectBrush, CompositionEffectFactory, Compositor,
        ContainerVisual, Desktop::DesktopWindowTarget, RectangleClip, SpriteVisual, Visual,
    },
    Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DWMWA_USE_HOSTBACKDROPBRUSH, DwmSetWindowAttribute},
        System::{
            Threading::GetCurrentThreadId,
            WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
                DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT, DispatcherQueueOptions,
                RO_INIT_SINGLETHREADED, RoInitialize, RoUninitialize,
            },
        },
        UI::WindowsAndMessaging::{
            DispatchMessageW, MSG, MWMO_INPUTAVAILABLE, MsgWaitForMultipleObjectsEx, PM_REMOVE,
            PeekMessageW, PostQuitMessage, QS_ALLINPUT, TranslateMessage, WM_QUIT,
        },
    },
    core::{BOOL, Interface, Result as WinResult},
};
use windows_numerics::Vector2;

type Result<T> = std::result::Result<T, String>;
static UI_THREAD: AtomicU32 = AtomicU32::new(0);
static DIAGNOSTICS: AtomicUsize = AtomicUsize::new(0);
thread_local! {
    static STATE: RefCell<Option<Backend>> = const { RefCell::new(None) };
    static CLOSING: Cell<bool> = const { Cell::new(false) };
    static PENDING_HIDE: Cell<bool> = const { Cell::new(false) };
    static PENDING_DESTROY: Cell<bool> = const { Cell::new(false) };
}

fn diagnostic(message: impl std::fmt::Display) {
    let n = DIAGNOSTICS.fetch_add(1, Ordering::Relaxed);
    if n < 64 {
        let text: String = message
            .to_string()
            .replace(['\r', '\n'], " ")
            .chars()
            .take(300)
            .collect();
        eprintln!("Windows backdrop: {text}");
    } else if n == 64 {
        eprintln!("Windows backdrop: further repeated diagnostics suppressed");
    }
}
fn checked(context: &str, result: WinResult<()>) {
    if let Err(error) = result {
        diagnostic(format!("{context}: {error}"));
    }
}
pub fn initialize_ui_thread() {
    let id = unsafe { GetCurrentThreadId() };
    if let Err(old) = UI_THREAD.compare_exchange(0, id, Ordering::Relaxed, Ordering::Relaxed)
        && old != id
    {
        diagnostic("refusing to change composition UI thread");
    }
}
fn require_ui() -> Result<()> {
    if UI_THREAD.load(Ordering::Relaxed) == unsafe { GetCurrentThreadId() } {
        Ok(())
    } else {
        Err("Composition must run on the registered UI thread".into())
    }
}

#[derive(Clone, Copy)]
struct Snapshot {
    hwnd: isize,
    client: (u32, u32),
    outer: (u32, u32),
    visible: bool,
    scale: f64,
}
fn snapshot(window: &WebviewWindow) -> Result<Snapshot> {
    let client = window.inner_size().map_err(|error| error.to_string())?;
    let outer = window.outer_size().map_err(|error| error.to_string())?;
    Ok(Snapshot {
        hwnd: window.hwnd().map_err(|error| error.to_string())?.0 as isize,
        client: (client.width, client.height),
        outer: (outer.width, outer.height),
        visible: window.is_visible().map_err(|error| error.to_string())?,
        scale: window.scale_factor().map_err(|error| error.to_string())?,
    })
}

pub fn apply(window: &WebviewWindow, clip: Clip, blur: u8, opacity: u8) -> Result<()> {
    require_ui()?;
    if !window_clip::may_create_layer(window.label(), CLOSING.with(Cell::get)) {
        return Err("Content backdrop is unavailable for this window or during shutdown".into());
    }
    clip.validate()?;
    let geometry = snapshot(window)?;
    let sigma = window_clip::physical_sigma(blur, opacity, geometry.scale)?;
    match window_clip::geometry_match(&clip, geometry.client, geometry.outer, geometry.visible) {
        GeometryMatch::Current => {}
        GeometryMatch::Stale => {
            hide();
            return Ok(());
        }
        GeometryMatch::UnexpectedFrame => {
            hide();
            return Err("Unexpected native surface frame".into());
        }
    }
    let Some(sigma) = sigma else {
        hide();
        return Ok(());
    };
    let result = STATE.with(|state| {
        let mut state = state
            .try_borrow_mut()
            .map_err(|_| "Composition is handling a reentrant UI event")?;
        if state.is_none() {
            *state = Some(
                Backend::new().map_err(|error| format!("Composition initialization: {error}"))?,
            );
        }
        state
            .as_mut()
            .ok_or("Composition unavailable")?
            .apply(geometry, clip, sigma)
    });
    drain_pending();
    if let Err(error) = &result {
        diagnostic(error);
    }
    result
}

/// Called synchronously before publishing an animation phase or on resize.
pub fn hide() {
    if let Err(error) = require_ui() {
        diagnostic(error);
        return;
    }
    PENDING_HIDE.with(|pending| pending.set(true));
    drain_pending();
}
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" || UI_THREAD.load(Ordering::Relaxed) == 0 {
        return;
    }
    if let Err(error) = require_ui() {
        diagnostic(error);
        return;
    }
    match event {
        WindowEvent::Destroyed => PENDING_DESTROY.with(|pending| pending.set(true)),
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            // The DOM must supply a new matching clip. Never stretch into an opaque row.
            PENDING_HIDE.with(|pending| pending.set(true));
        }
        _ => return,
    }
    drain_pending();
}
fn drain_pending() {
    STATE.with(|state| {
        let Ok(mut state) = state.try_borrow_mut() else {
            return;
        };
        let Some(backend) = state.as_mut() else {
            PENDING_HIDE.with(|pending| pending.set(false));
            PENDING_DESTROY.with(|pending| pending.set(false));
            return;
        };
        if CLOSING.with(Cell::get) {
            backend.begin_shutdown();
            return;
        }
        if PENDING_DESTROY.with(|pending| pending.replace(false)) {
            backend.layer.take();
        }
        if PENDING_HIDE.with(|pending| pending.replace(false))
            && let Some(layer) = &backend.layer
        {
            checked("hide content backdrop", layer.root.SetOpacity(0.0));
        }
    });
}

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}
struct Backend {
    layer: Option<Layer>,
    compositor: Option<Compositor>,
    queue: Option<DispatcherQueue>,
    controller: Option<DispatcherQueueController>,
    shutdown: Option<Box<dyn FnMut() -> WinResult<bool>>>,
    apartment: Option<Apartment>,
    closing: bool,
}
impl Backend {
    fn new() -> WinResult<Self> {
        unsafe {
            RoInitialize(RO_INIT_SINGLETHREADED)?;
        }
        let mut backend = Self {
            layer: None,
            compositor: None,
            queue: None,
            controller: None,
            shutdown: None,
            apartment: Some(Apartment),
            closing: false,
        };
        backend.queue = Some(match DispatcherQueue::GetForCurrentThread() {
            Ok(queue) => queue,
            Err(error) if error.code().0 == 0 || error.code().0 == 0x80004003u32 as i32 => {
                let controller = unsafe {
                    CreateDispatcherQueueController(DispatcherQueueOptions {
                        dwSize: size_of::<DispatcherQueueOptions>() as u32,
                        threadType: DQTYPE_THREAD_CURRENT,
                        apartmentType: DQTAT_COM_NONE,
                    })?
                };
                backend.controller = Some(controller.clone());
                controller.DispatcherQueue()?
            }
            Err(error) => return Err(error),
        });
        backend.compositor = Some(Compositor::new()?);
        Ok(backend)
    }
    fn apply(&mut self, geometry: Snapshot, clip: Clip, sigma: f32) -> Result<()> {
        if self.closing {
            return Err("Composition is closing".into());
        }
        let compositor = self.compositor.as_ref().ok_or("Composition unavailable")?;
        if self
            .layer
            .as_ref()
            .is_some_and(|layer| layer.hwnd != geometry.hwnd)
        {
            self.layer.take();
        }
        if self.layer.is_none() {
            self.layer = Some(
                Layer::new(compositor, geometry, clip.clone(), sigma)
                    .map_err(|error| error.to_string())?,
            );
        }
        let layer = self.layer.as_mut().ok_or("Composition unavailable")?;
        layer
            .root
            .SetOpacity(0.0)
            .map_err(|error| error.to_string())?;
        layer
            .update(compositor, clip, sigma)
            .map_err(|error| error.to_string())?;
        layer
            .root
            .SetOpacity(1.0)
            .map_err(|error| error.to_string())
    }
    fn begin_shutdown(&mut self) {
        if self.closing {
            return;
        }
        self.closing = true;
        self.layer.take();
        if let Some(compositor) = self.compositor.take() {
            checked("close compositor", compositor.Close());
        }
        if let Some(controller) = &self.controller {
            match controller.ShutdownQueueAsync() {
                Ok(action) => {
                    self.shutdown = Some(Box::new(move || {
                        if action.Status()?.0 == 0 {
                            return Ok(false);
                        }
                        action.GetResults()?;
                        Ok(true)
                    }))
                }
                Err(error) => diagnostic(format!("request queue shutdown: {error}")),
            }
        }
    }
    fn finish_shutdown(&mut self) {
        if self.apartment.is_none() {
            return;
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut finished = self.controller.is_none();
        let mut quit = None;
        while let Some(poll) = self.shutdown.as_mut() {
            match poll() {
                Ok(true) => {
                    finished = true;
                    break;
                }
                Ok(false) => {}
                Err(error) => {
                    diagnostic(format!("queue shutdown completion: {error}"));
                    break;
                }
            }
            if Instant::now() >= deadline {
                break;
            }
            let mut message = MSG::default();
            for _ in 0..64 {
                if Instant::now() >= deadline
                    || !unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool()
                {
                    break;
                }
                if message.message == WM_QUIT {
                    quit = Some(message.wParam.0 as i32);
                } else {
                    unsafe {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
            }
            let remaining = deadline
                .saturating_duration_since(Instant::now())
                .as_millis()
                .min(10) as u32;
            if unsafe {
                MsgWaitForMultipleObjectsEx(None, remaining, QS_ALLINPUT, MWMO_INPUTAVAILABLE)
            }
            .0 == u32::MAX
            {
                diagnostic("queue shutdown message wait failed");
                break;
            }
        }
        if let Some(code) = quit {
            unsafe { PostQuitMessage(code) };
        }
        if !finished {
            diagnostic(
                "owned queue failed to finish within 2s; retaining queue/apartment until process exit",
            );
            std::mem::forget(self.shutdown.take());
            std::mem::forget(self.controller.take());
            std::mem::forget(self.queue.take());
            std::mem::forget(self.apartment.take());
            return;
        }
        self.shutdown.take();
        self.controller.take();
        self.queue.take();
        self.apartment.take();
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.begin_shutdown();
        self.finish_shutdown();
    }
}

// Public D2D effect graph adapter, ported from Quorb; no capture or private API.
mod gaussian {
    use std::sync::Mutex;
    use windows::{
        Foundation::{IPropertyValue, PropertyValue},
        Graphics::Effects::{
            IGraphicsEffect, IGraphicsEffect_Impl, IGraphicsEffectSource,
            IGraphicsEffectSource_Impl,
        },
        UI::Composition::CompositionEffectSourceParameter,
        Win32::System::WinRT::Graphics::Direct2D::{
            GRAPHICS_EFFECT_PROPERTY_MAPPING, GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT,
            IGraphicsEffectD2D1Interop, IGraphicsEffectD2D1Interop_Impl,
        },
        core::{GUID, HRESULT, HSTRING, Interface, PCWSTR, implement},
    };
    type Result<T> = windows::core::Result<T>;
    fn invalid() -> windows::core::Error {
        windows::core::Error::from_hresult(HRESULT(0x80070057u32 as i32))
    }
    #[implement(IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectD2D1Interop)]
    struct Gaussian {
        name: Mutex<HSTRING>,
        sigma: f32,
        source: IGraphicsEffectSource,
    }
    impl IGraphicsEffect_Impl for Gaussian_Impl {
        fn Name(&self) -> Result<HSTRING> {
            Ok(self.name.lock().map_err(|_| invalid())?.clone())
        }
        fn SetName(&self, value: &HSTRING) -> Result<()> {
            *self.name.lock().map_err(|_| invalid())? = value.clone();
            Ok(())
        }
    }
    impl IGraphicsEffectSource_Impl for Gaussian_Impl {}
    impl IGraphicsEffectD2D1Interop_Impl for Gaussian_Impl {
        fn GetEffectId(&self) -> Result<GUID> {
            Ok(GUID::from_u128(0x1feb6d69_2fe6_4ac9_8c58_1d7f93e7a6a5))
        }
        fn GetNamedPropertyMapping(
            &self,
            name: &PCWSTR,
            index: *mut u32,
            mapping: *mut GRAPHICS_EFFECT_PROPERTY_MAPPING,
        ) -> Result<()> {
            if name.is_null() || index.is_null() || mapping.is_null() {
                return Err(invalid());
            }
            let property = match unsafe { name.to_string()? }.as_str() {
                "StandardDeviation" => 0,
                "Optimization" => 1,
                "BorderMode" => 2,
                _ => return Err(invalid()),
            };
            unsafe {
                *index = property;
                *mapping = GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT;
            }
            Ok(())
        }
        fn GetPropertyCount(&self) -> Result<u32> {
            Ok(3)
        }
        fn GetProperty(&self, index: u32) -> Result<IPropertyValue> {
            match index {
                0 => PropertyValue::CreateSingle(self.sigma)?.cast(),
                1 | 2 => PropertyValue::CreateUInt32(1)?.cast(),
                _ => Err(invalid()),
            }
        }
        fn GetSource(&self, index: u32) -> Result<IGraphicsEffectSource> {
            if index != 0 {
                return Err(invalid());
            }
            Ok(self.source.clone())
        }
        fn GetSourceCount(&self) -> Result<u32> {
            Ok(1)
        }
    }
    pub fn create(sigma: f32) -> Result<IGraphicsEffect> {
        if !sigma.is_finite() || sigma <= 0.0 {
            return Err(invalid());
        }
        Ok(Gaussian {
            name: Mutex::new(HSTRING::from("RawGaussian")),
            sigma,
            source: CompositionEffectSourceParameter::Create(&HSTRING::from("rawBackdrop"))?
                .cast()?,
        }
        .into())
    }
}

struct BrushResources {
    source: Option<CompositionBackdropBrush>,
    factory: Option<CompositionEffectFactory>,
    effect: Option<CompositionEffectBrush>,
    sigma: Option<f32>,
}
impl BrushResources {
    fn empty() -> Self {
        Self {
            source: None,
            factory: None,
            effect: None,
            sigma: None,
        }
    }
    fn install(compositor: &Compositor, sprite: &SpriteVisual, sigma: f32) -> WinResult<Self> {
        let mut graph = Self::empty();
        graph.source = Some(compositor.CreateBackdropBrush()?);
        graph.factory = Some(compositor.CreateEffectFactory(&gaussian::create(sigma)?)?);
        graph.effect = Some(graph.factory.as_ref().unwrap().CreateBrush()?);
        graph.effect.as_ref().unwrap().SetSourceParameter(
            &windows::core::HSTRING::from("rawBackdrop"),
            graph.source.as_ref().unwrap(),
        )?;
        sprite.SetBrush(graph.effect.as_ref().unwrap())?;
        graph.sigma = Some(sigma);
        Ok(graph)
    }
}
impl Drop for BrushResources {
    fn drop(&mut self) {
        if let Some(effect) = self.effect.take() {
            checked("close Gaussian effect", effect.Close());
        }
        if let Some(factory) = self.factory.take() {
            checked("close Gaussian factory", factory.Close());
        }
        if let Some(source) = self.source.take() {
            checked("close backdrop source", source.Close());
        }
    }
}

fn create_with_host_attribute<T>(
    enable: impl FnOnce() -> WinResult<()>,
    create: impl FnOnce() -> WinResult<T>,
) -> WinResult<T> {
    checked("optional host backdrop attribute", enable());
    create()
}
struct Layer {
    hwnd: isize,
    target: Option<DesktopWindowTarget>,
    sprite: SpriteVisual,
    root: ContainerVisual,
    brush: BrushResources,
    clip: Option<RectangleClip>,
    shape: Clip,
}
impl Layer {
    fn new(
        compositor: &Compositor,
        geometry: Snapshot,
        shape: Clip,
        sigma: f32,
    ) -> WinResult<Self> {
        create_with_host_attribute(
            || {
                let enabled = BOOL(1);
                unsafe {
                    DwmSetWindowAttribute(
                        HWND(geometry.hwnd as _),
                        DWMWA_USE_HOSTBACKDROPBRUSH,
                        (&enabled as *const BOOL).cast(),
                        size_of::<BOOL>() as u32,
                    )
                }
            },
            || Self::create_visuals(compositor, geometry, shape, sigma),
        )
    }
    fn create_visuals(
        compositor: &Compositor,
        geometry: Snapshot,
        shape: Clip,
        sigma: f32,
    ) -> WinResult<Self> {
        let sprite = compositor.CreateSpriteVisual()?;
        let root = match compositor.CreateContainerVisual() {
            Ok(root) => root,
            Err(error) => {
                checked("close unparented sprite", sprite.Close());
                return Err(error);
            }
        };
        let mut layer = Self {
            hwnd: geometry.hwnd,
            target: None,
            sprite,
            root,
            brush: BrushResources::empty(),
            clip: None,
            shape: shape.clone(),
        };
        layer.root.SetOpacity(0.0)?;
        layer.root.Children()?.InsertAtTop(&layer.sprite)?;
        layer.update(compositor, shape, sigma)?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        layer.target =
            Some(unsafe { interop.CreateDesktopWindowTarget(HWND(geometry.hwnd as _), false)? });
        if let Some(target) = &layer.target {
            target.SetRoot(&layer.root)?;
        }
        Ok(layer)
    }
    fn update(&mut self, compositor: &Compositor, shape: Clip, sigma: f32) -> WinResult<()> {
        if self.brush.sigma != Some(sigma) {
            let replacement = BrushResources::install(compositor, &self.sprite, sigma)?;
            self.brush = replacement;
        }
        if shape == self.shape && self.clip.is_some() {
            return Ok(());
        }
        let zero = Vector2 { X: 0.0, Y: 0.0 };
        let clip = compositor.CreateRectangleClipWithSidesAndRadius(
            shape.x as f32,
            shape.y as f32,
            (shape.x + shape.content_width) as f32,
            (shape.y + shape.content_height) as f32,
            zero,
            zero,
            zero,
            zero,
        )?;
        self.root.SetClip(&clip)?;
        self.sprite.SetClip(&clip)?;
        if let Some(old) = self.clip.replace(clip) {
            checked("close replaced clip", old.Close());
        }
        let size = Vector2 {
            X: shape.width as f32,
            Y: shape.height as f32,
        };
        self.root.SetSize(size)?;
        self.sprite.SetSize(size)?;
        self.shape = shape;
        Ok(())
    }
}
impl Drop for Layer {
    fn drop(&mut self) {
        if let Some(target) = self.target.take() {
            checked("detach root", target.SetRoot(None::<&Visual>));
            checked("close target", target.Close());
        }
        checked(
            "remove backdrop children",
            self.root
                .Children()
                .and_then(|children| children.RemoveAll()),
        );
        checked("close sprite", self.sprite.Close());
        self.brush = BrushResources::empty();
        checked("close backdrop root", self.root.Close());
        if let Some(clip) = self.clip.take() {
            checked("close clip", clip.Close());
        }
    }
}

pub fn begin_shutdown() {
    if let Err(error) = require_ui() {
        diagnostic(error);
        return;
    }
    CLOSING.with(|closing| closing.set(true));
    drain_pending();
}
pub fn finish_shutdown() {
    if let Err(error) = require_ui() {
        diagnostic(error);
        return;
    }
    begin_shutdown();
    let backend = STATE.with(|state| {
        state
            .try_borrow_mut()
            .ok()
            .and_then(|mut state| state.take())
    });
    if let Some(mut backend) = backend {
        backend.finish_shutdown();
    }
}

#[cfg(test)]
mod host_attribute_contract_tests {
    use super::*;
    use windows::core::{Error, HRESULT};
    #[test]
    fn unsupported_host_attribute_still_attempts_the_gaussian_layer_and_preserves_errors() {
        for unsupported in [HRESULT(0x80070057u32 as i32), HRESULT(0x80004001u32 as i32)] {
            let calls = RefCell::new(Vec::new());
            let result = create_with_host_attribute(
                || {
                    calls.borrow_mut().push("host");
                    Err(Error::from_hresult(unsupported))
                },
                || {
                    calls.borrow_mut().push("gaussian");
                    Ok("layer")
                },
            );
            assert_eq!(calls.into_inner(), ["host", "gaussian"]);
            assert_eq!(result.ok(), Some("layer"));
            let failure = HRESULT(0x8007000Eu32 as i32);
            let result = create_with_host_attribute::<()>(
                || Err(Error::from_hresult(unsupported)),
                || Err(Error::from_hresult(failure)),
            );
            assert_eq!(result.unwrap_err().code(), failure);
        }
    }
}
