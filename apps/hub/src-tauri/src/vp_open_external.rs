use super::open_with;
fn outcome(url: &str) -> Result<String, String> {
    let mut opened = None;
    open_with(url, |u| {
        opened = Some(u.to_owned());
        Ok(())
    })
    .map(|()| opened.expect("opened once"))
}
#[test]
fn vp_dot_segments_idn_and_trailing_dots_cannot_escape_the_allowlist() {
    for url in [
        "https://github.com/egdev6/../evil",
        "https://github.com/egdev6/%2e%2e/evil",
        "https://github.com/egdev6/%2E%2E",
        "https://github.com./egdev6/nexo",
        "https://www.youtube.com./watch",
        "https://xn--gthub-cta.com/egdev6/nexo",
        "https://gіthub.com/egdev6/nexo",
        "https://github.com%2eevil.example/egdev6/nexo",
        "https:github.com/egdev6/nexo",
        "https:/github.com/egdev6/nexo",
        "javascript:alert(1)//https://github.com/egdev6",
        "",
    ] {
        assert_eq!(outcome(url), Err("nexo.external.refused".into()), "{url:?}");
    }
}
#[test]
fn vp_only_the_canonical_url_reaches_the_system_opener() {
    assert_eq!(
        outcome("https://ｇithub.com/egdev6/nexo"),
        Ok("https://github.com/egdev6/nexo".into())
    );
    assert_eq!(
        outcome("https://github.com/egdev6/nexo/./x"),
        Ok("https://github.com/egdev6/nexo/x".into())
    );
    assert_eq!(
        outcome("https://github.com/egdev6/a b"),
        Ok("https://github.com/egdev6/a%20b".into())
    );
}
