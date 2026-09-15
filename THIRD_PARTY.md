# Third-party components and attribution

MoAH is an independent project built on Pi. It is not an official Pi release.
The MIT license in this repository covers original MoAH code and documentation;
dependencies, model weights and third-party metadata retain their own licenses.

- [Pi](https://github.com/earendil-works/pi), pinned to 0.85.1: original agent,
  package manager, tools, SDK and example extensions. Dependencies are installed
  through npm; upstream implementations are not renamed as MoAH tools.
- [pi-web-tools](https://www.npmjs.com/package/@bitcraft-apps/pi-web-tools), 1.6.0:
  original websearch and webfetch implementations.
- [pi-json-schema](https://www.npmjs.com/package/@nqbao/pi-json-schema), 0.1.1:
  included in the research profile; dormant unless its upstream activation
  conditions are met.
- [Transformers.js](https://github.com/huggingface/transformers.js) and ONNX Runtime:
  optional local semantic retrieval. The optional model is
  [multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small).
- Other npm dependencies and their versions are recorded in package-lock.json.
  Consult each installed package's license before redistribution.
- ddgr and Pandoc are separate optional web-tool prerequisites. The Python
  requirements install their own distributions and associated licenses.

The lazy SDK adapter delegates to installed upstream Pi helper modules. Its
compatibility boundary is Pi 0.85.1. The full SDK remains the fallback.

The public Pi package index is fetched from pi.dev with source and capture
metadata. It is not a MoAH-authored tool collection. This repository publishes
its measurement provenance, not a relicensed copy of third-party descriptions.
