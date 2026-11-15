# Troubleshooting startup

On Windows, Nexo records startup diagnostics in
`%LOCALAPPDATA%\es.egdev.nexo\logs\startup.log`. Paste that path into File
Explorer to find it. If startup fails, the error dialog also points to this file.
The log includes the version, process ID, startup errors, and whether a launch
is handing off to a running instance (with its process ID when available).

Each line begins with Unix time in seconds and milliseconds, for example
`[42.123 UTC]`. The log retains recent complete lines when it approaches 256 KiB;
individual exceptionally long messages are truncated. Logging is best-effort,
so a permissions or storage problem can prevent the file from being written.
On non-Windows systems the equivalent path is under the system temporary directory.
