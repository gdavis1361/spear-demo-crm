// Test setup — install `fake-indexeddb` so the IDB-backed code paths run
// in node/happy-dom. Per-suite reset is each test's responsibility (call
// `await store.clear()` in beforeEach).

import 'fake-indexeddb/auto';
