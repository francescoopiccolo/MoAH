# Research preview and dependency status

Tool workers have the same operating-system privileges as Pi. They are not a
sandbox. Only execute trusted extensions. Public descriptions are metadata,
not instructions or endorsements.

An npm audit on 15 September 2026 reported four high-severity package entries
in the pinned optional semantic tree: Transformers.js, onnxruntime-node,
adm-zip and sharp. Underlying reports concern archive handling and image-codec
libraries. npm reported no automatic fix for this dependency set. Disabling
semantic retrieval reduces its runtime use but does not remove dependencies
or prove that the installation is unaffected.

The preview retains evaluated versions for reproducibility; it does not claim
a clean dependency audit. A hardened release needs separation/upgrades of this
stack and requalification. Do not expose this preview as a multi-user service.

Use GitHub private vulnerability reporting when available. Do not post credentials
or private session logs in public issues.
