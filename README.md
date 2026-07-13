# @schemastud/blockdoc

Manifest-driven ProseMirror documents. The `/core` subpath (React-free) ships:

- TypeScript types for the **blockdoc node-manifest format** (`BlockdocManifest`, `NodeManifestEntry`, `MarkManifestEntry`, `DocManifest`),
- `assemblePMSchema(manifest | manifest[])` — compiles one or more manifests into a ProseMirror `Schema` (via `@tiptap/pm/model`),
- the exported derivation pieces the Tiptap extension generator shares (`collectManifestEntries`, `allBlockCategories`, `contentExpressionFor`, `attrsFromSchema`, `groupsFor`),
- id conventions: `generateNodeId()` (UUIDv7, matching the server's `Str::uuid7()`) and `NODE_ID_ATTR` (`'id'`).

Nothing under `src/core` imports React or RJSF. The editing half ships as two more subpaths:

- **`/react`** — the `BlockdocEditor` island on **Tiptap** (v3, ADR-0072 as amended by
  splicewire-editor issue 11). `createManifestExtensions(manifests, { docAdmits?, nodeViews? })`
  GENERATES the Tiptap `Node`/`Mark` extensions from the manifests at runtime — never
  hand-authored per node type — reusing the exact derivation pieces `src/core/assemble.ts`
  exports (`collectManifestEntries`, `allBlockCategories`, `contentExpressionFor`,
  `attrsFromSchema`, `groupsFor`), so `assemblePMSchema` stays the conformance oracle
  (`tests/schema-parity.test.ts` pins both compilations to the same accept/reject behavior).
  The generated extensions carry the editing DOM: semantic tags for the base prose set
  (`p`, `h{level}`, `blockquote`, `ul`/`ol`/`li`, `pre>code`, `hr`, `br`) with `data-node-id`,
  generic `div[data-node-type]` for typed blocks, and marks as `strong`/`em`/`code`/`a[href]`/
  `span[data-annotation-id]`. The island (`useEditor`/`EditorContent`) commits `doc.toJSON()`
  through `onChange` on trailing debounce (default 400ms), blur, and `flushCommits()` (ref or
  `commitBus`); a last-committed guard absorbs the RJSF onChange echo while a genuinely external
  value rebuilds the document via a commit-suppressed, history-free `setContent` (selection
  remapped by node id, undo history effectively fresh) without firing a commit. A free-tier
  `BubbleMenu` offers bold/italic/code and prompt-free link set/unset for whichever of those
  marks the manifests declare. NodeView registry: `registerNodeView(name, Component)` overrides;
  unregistered non-base-prose nodes get the generic NodeView (labeled chrome + a `SchemaForm`
  over the node's attrs — the drill-down seam); components keep the `NodeViewComponentProps`
  contract and ride `ReactNodeViewRenderer`/`NodeViewWrapper` through the `tiptapNodeView`
  adapter. Collab seams prepared but empty: `extraPlugins({ schema })` and the `DocSource`
  abstraction (default `valueDocSource`).

  **Guardrails** (enforced by `tests/no-pro-imports.test.ts`): MIT core + free extensions only —
  no `@tiptap-pro`/cloud modules (collab is Reverb + y-prosemirror later; comments are our
  annotation marks; AI is the intent bus). Our integrity plugins (node-id UUIDv7 uniqueness,
  annotation-mark id integrity) stay RAW ProseMirror plugins registered through
  `addProseMirrorPlugins` — one-layer portability in both directions — and every ProseMirror
  import rides `@tiptap/pm/*` so exactly one PM instance exists.
- **`/rjsf`** — `createRichContentWidget(nodeViewRegistry, defaults?)` producing a component that
  mounts as an RJSF field (object values) or widget: reads `manifest`/`manifestRef` (resolved via
  `formContext.schemaFetcher`, falling back to `defaults.schemaFetcher`), `palette`, and `commit`
  from `ui:options`; assembles `[defaults.baseManifest, profile]`; runs advisory client-side
  validation of the field schema at commit boundaries (server stays authoritative).

```ts
import { assemblePMSchema, generateNodeId } from '@schemastud/blockdoc/core';

const schema = assemblePMSchema([baseManifest, contentManifest]);
const doc = schema.nodeFromJSON(json);
doc.check(); // containment enforcement — throws on category violations
```

## Manifest format (v1, frozen 2026-07-10)

Both sides build against this exact JSON shape: the server export command
(`block-schema:export-manifest`) emits it per profile; the client `assemblePMSchema`
consumes it. The base prose set is NOT emitted per profile — it is the hand-authored
`base` manifest vendored client-side (see `tests/fixtures/base.manifest.json`).

```jsonc
{
  "profile": "content",            // profile key, or "base" for the vendored base set
  "version": 1,                    // manifest format version
  "doc": {
    // What the document node admits, same semantics as node admitsChildCategories.
    "admitsChildCategories": ["section"]
  },
  "nodes": [
    {
      "name": "contentSection",           // PM node type name == server #[NodeType] name
      "description": "…",                  // optional
      "group": "block",                    // from #[NodeType]->group; 'block' | 'inline'
      "category": "section",               // Block::category(); becomes the PM group; null allowed
      "admitsChildCategories": ["prose"],  // null = unconstrained; [] = leaf; list = category union
      "admitsText": false,                 // true → textblock (content 'inline*') when admitsChildCategories is null
      "contentExpression": null,           // explicit escape hatch (base set only); overrides derivation
      "attrsSchema": {                     // JSON Schema object over node attrs; id ALWAYS present
        "type": "object",
        "properties": {
          "id": { "type": ["string", "null"] },
          "heading": { "type": "string" }
        }
      }
    }
  ],
  "marks": [
    { "name": "strong" },
    { "name": "em" },
    { "name": "code" },
    { "name": "link", "attrsSchema": { "type": "object", "properties": { "href": { "type": "string" } } } },
    {
      "name": "annotation",
      "attrsSchema": { "type": "object", "properties": { "id": { "type": ["string", "null"] } } },
      "excludes": ""                        // PM excludes; "" allows overlapping same-type marks
    }
  ]
}
```

## Derivation rules (assemblePMSchema)

1. `contentExpression` set → used verbatim.
2. else `admitsChildCategories` is a list → content `(catA | catB)*` (PM group union);
   empty list → leaf (no content).
3. else (`null`) → `admitsText: true` → content `'inline*'`; otherwise UNCONSTRAINED:
   the union of every block category the composed manifests declare, `(cat1 | cat2 | …)*`
   (degrading to a leaf only when no categories exist).
4. PM `group` per node = its `category` (nodes are addressed in content expressions by
   category). Nodes with manifest `group: 'inline'` additionally join the PM `inline`
   group (and get `inline: true`) so `'inline*'` reaches them.
5. Node attrs = keys of `attrsSchema.properties`, each `{ default: schema.default ?? null }`;
   `id` is force-present with default `null`.
6. The `doc` node's content derives from `doc.admitsChildCategories` by rules 2/3
   (a doc never admits raw text).
7. The `text` node is implicit (PM group `inline`); manifests never declare it —
   declaring `text` or `doc` throws.
8. Marks: attrs from `attrsSchema.properties` same as nodes (no forced `id`);
   `excludes` passed through when present (including `''`).

**Merging** (array argument, e.g. `[base, profile]`): nodes and marks concatenate in
order; a later manifest may **not** redeclare an existing node name — that throws.
(Mark redeclaration also throws; that is this implementation's choice, the frozen
format only mandates it for nodes.) The **last** manifest with a non-null `doc` wins;
if no manifest carries a `doc`, assembly throws.

## Known limits of the category → content-expression derivation

Prototyped against the real `content` profile vocabulary
(`ContentArticleBlock` / `ContentOutlineBlock` / `ContentSectionBlock` in
splicewire-app, mirrored by hand in `tests/fixtures/content-article.manifest.json`).
These are the semantics that do **not** compile cleanly:

1. **Null-category nodes are untargetable.** A node whose `category` is `null` joins no
   PM group, so no category-derived expression can ever admit it — it can only be the
   (mapped-away) root or dead vocabulary. This is real, not hypothetical:
   `ContentArticleBlock` does not override `Block::category()`, so the article root has
   no category. The fixture keeps `contentArticle` faithful (category `null`) and instead
   gives the *doc* node the article's role (`doc.admitsChildCategories: ["section"]`);
   the export command must decide whether root blocks map to `doc` or get a category.
2. **Ordering is not derived — only arity is.** By default categories compile to
   `(a | b)*` (unordered, unbounded repetition). **Arity** is now expressible via the
   `childConstraints` manifest field (B1): `childConstraints: { section: { required:
   true }, heading: { max: 1 } }` compiles to a quantified sequence
   (`heading? section+`) — `min`/`max`/`required` become PM repetition operators
   (`+`, `?`, `{n}`, `{min,max}`), and a `max: 0` category is dropped. **Ordering** —
   the real `content_article`'s Beats draining outline **then** sections — is still not
   inferred; declaring `childConstraints` pins the `admitsChildCategories` order as a
   side effect, but for order *without* arity use the `contentExpression` escape hatch
   (now allowed in profile manifests, not just the base set). A manifest with no
   `childConstraints` compiles exactly as before (no regression).
3. ~~**Single-category unions are still just repetition.**~~ **Resolved by B1.**
   `["list_item"]` still derives `(list_item)*` by default, but
   `childConstraints: { list_item: { required: true } }` now says "at least one" and
   `{ min: 1, max: 1 }` says "exactly one".
4. **`null` ("unconstrained") has no exact PM equivalent.** Server-side, a `null`
   `admitsChildCategories` means "admits anything" (`Block::withContent` enforces
   nothing). PM has no "any" wildcard, so the derivation compiles `null` to the
   enumerated union of every block category the composed manifests declare — faithful
   to the server for every category that exists at assembly time, but a node whose
   category no manifest declares remains unplaceable. (`admitsText: true` still takes
   precedence and compiles to `'inline*'`.) The real `ContentSectionBlock` also carries
   duplicate prose as a flat `body` string attr; whether that attr yields to child
   prose is a per-block server decision the client cannot infer.
5. **Category `$id`s are not PM-safe tokens.** Real categories are URL `$id`s
   (e.g. `https://app.splicewire.com/json-schemas/block-category/content-section`).
   PM's content-expression tokenizer only accepts word characters, so raw `$id`s cannot
   be PM group names. The fixtures use short tokens (`section`, `outline`, `prose`);
   the export command must emit a stable PM-safe slug per category `$id`, not the raw id.
6. **Name casing.** Server `#[NodeType]` names are snake_case (`content_section`) —
   valid PM names — while the hand-authored fixtures follow PM's camelCase convention
   (`contentSection`, matching `bullet_list`/`list_item` in the base set). The export
   command must pick one convention; the client treats names as opaque.

## Fixtures

- `tests/fixtures/base.manifest.json` — the vendored base prose vocabulary
  (paragraph, heading, blockquote, lists, code_block, horizontal_rule, hard_break;
  marks strong/em/code/link/annotation). Carries `doc: null` — the profile manifest
  owns the doc.
- `tests/fixtures/content-article.manifest.json` — the `content` profile vocabulary
  mirrored by hand from the server blocks, with the adaptations documented above.

## Collaboration seams (reserved, no collab built — B4)

The package reserves five seams so a future collaboration build (y-prosemirror /
presence transport) plugs in without reshaping the editor. All are **reservation-only**
today:

1. **`DocSource`** (`docSource` prop) — the editor reads its doc through
   `DocSource{get(); subscribe?()}`, not only a `value` prop; a collab-backed source pushes
   remote docs through `subscribe`.
2. **`extraPlugins`** — raw PM plugins appended to the island's list (the transport plugs
   in here).
3. **Swappable id-plugin** (`idPlugin` prop) — defaults to `nodeIdPlugin`; a collab build
   replaces it with a CRDT-aware plugin.
4. **Intent `origin`** — the `FormIntentBusLike` intent payload carries an optional
   `origin` so an inline-AI / remote write is distinguishable from a local edit; the flush
   path stays pluggable (`registerFlush`), and AI writes ride the same transport (no side
   channel).
5. **Annotation mark + `document_bindings` anchor** — `annotation-plugin` keeps the
   comment/binding anchor open; never a second CRDT.

**The named debt (the crux invariant):** *stable node ids MUST survive a CRDT merge.* The
document is a location index so one CRDT suffices (truth is SQL-authoritative — see the
`document-is-a-location-index` doctrine), but a merge could duplicate or drop ids.
`NodeIdRematcher` does **not** cover concurrency (it is single-user content-similarity
rematch). The collaboration effort owns id-merge-safety **and** a post-merge validity pass
(a concurrently-valid pair of edits can merge to an invalid tree). Presence/lock state lives
in the transport, **never** in the document (see `lock-and-presence-state-lives-in-transport`).

## Development

```sh
npm install
npm test        # vitest
npm run typecheck
```
