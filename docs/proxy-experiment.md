# HTTPS proxy experiment — stopped

This experimental phone-capture route is **not recommended** for normal use.
Use the [Firefox exporter](../firefox-extension/README.md) instead.

After the owner's approval, a computer-local mitmproxy instance was connected
through an ADB reverse tunnel. A dedicated capture CA was made visible only in
the running Marjane process's mount namespace; the system CA store and zygote
namespace were not changed. `scripts/device_proxy_mount.sh` is retained as
experimental research code, not as a supported setup command.

Crucially, the Android HTTP proxy setting was **device-wide**, even though only
Marjane's API host was selected for TLS interception and only history endpoints
were selected for logging. When USB forwarding disappeared, traffic from the
whole device could no longer reach the configured proxy. This disrupted the
owner's internet. Scoping logs or certificate trust does not scope that routing
risk; this should have been made explicit before configuration.

## Cleanup performed

- Saved original proxy settings before the experiment.
- Restored all five saved global proxy/PAC settings; each was originally unset.
- Verified all five were unset afterward and the connectivity service no longer
  referenced the capture port.
- Stopped the local mitmproxy process. USB forwarding was already absent.
- The app had restarted, so the trust mount tied to its former process namespace
  was no longer associated with the running app. No persistent Magisk module,
  boot service or system certificate installation was created.

Temporary public CA copies/scripts may remain under the experiment's
`/data/local/tmp/marjane-re-*` paths. The dedicated CA's private key and local
logs stay in ignored `captures/`; neither is included in source control or the
Firefox extension package. The app APK was not modified.

The proxy recorded one successful empty online-order response and one request
error; it did not establish a working complete phone-based history export.
No raw authentication-header values or receipt scalar values were persisted by
the metadata addon. `scripts/proxy_history.py` and its redaction tests document
that logging boundary, not proof that the phone setup was operationally safe.
