# MoAH bundled Pi corpus

This directory is a source copy of the selected official Pi examples at Pi
`v0.85.1`, commit `d981de1229ef899957bbe968bc8dcda02a21f477`. It is shipped as
part of the MoAH package, not downloaded, cloned, or updated during a task.

`../../../pi-official-capabilities.json` is the authoritative generated
provenance manifest. It records exact source paths, URLs, commits, SHA-256
content hashes, static audit facts, dependency-policy status and measurement
status. `src/corpus.ts` verifies each loaded entry against that manifest; a
configuration file cannot elevate arbitrary code to this corpus.

All entries are `pi-official-example`, not claims of production support. The
current worker allowlist is empty. These extensions are therefore supplied for
Pi-native lifecycle loading and schema visibility routing only. Core Pi tools
are supplied by the lockfile-pinned `@earendil-works/pi-coding-agent@0.85.1`
dependency rather than duplicated here.
