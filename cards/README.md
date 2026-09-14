# Card Studio examples

`data/beast/furball.json` documents the versioned gameplay-metadata schema with a concrete Furball example. It is a fixture/reference file, not an automatic seed.

The desktop app stores each user's working files below Electron's `userData/cards` directory. It creates missing gameplay metadata from the selected catalog card and writes it only when the user chooses **Save Metadata**.
