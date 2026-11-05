# mobile-react-native (future)

React Native client. Not started; this directory holds only this README until the work is requested. No placeholder implementation belongs here.

## Contract it must satisfy

- Talk to the backend only over the HTTP API v1 described in `CLAUDE.md` §5.
- Import schemas and types from `@vp/domain-schema/wire`, and never import `@vp/domain-schema/rules`. Its tests may use `@vp/domain-schema/testing`.
- Publish its own consumer pact, verified by every backend. See `CLAUDE.md` §6.5.
- Stay compatible with app versions still in use, since they can't be force-updated.
