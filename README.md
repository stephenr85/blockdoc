# @stephenr85/blockdoc

Manifest-driven ProseMirror documents. The `/core` subpath (React-free) ships:

- TypeScript types for the **blockdoc node-manifest format** (`BlockdocManifest`, `NodeManifestEntry`, `MarkManifestEntry`, `DocManifest`),
- `assemblePMSchema(manifest | manifest[])` — compiles one or more manifests into a `prosemirror-model` `Schema`,
- id conventions: `generateNodeId()` (UUIDv7, matching the server's `Str::uuid7()`) and `NODE_ID_ATTR` (`'id'`).

Nothing under `src/core` imports React or RJSF. The editing half ships as two more subpaths:

- **`/react`** — the `BlockdocEditor` island on raw `prosemirror-*` modules with a hand-rolled
  portal NodeView bridge. Owns `EditorState` for its lifetime; commits `doc.toJSON()` through
  `onChange` on trailing debounce (default 400ms), blur, and `flushCommits()` (ref or `commitBus`);
  a last-committed guard absorbs the RJSF onChange echo while a genuinely external value rebuilds
  state (fresh undo history, selection remapped by node id) without firing a commit. A node-id
  plugin keeps every id attr a unique UUIDv7. NodeView registry: `registerNodeView(name, Component)`
  overrides; unregistered non-base-prose nodes get the generic NodeView (labeled chrome + a
  `SchemaForm` over the node's attrs — the drill-down seam). Collab seams prepared but empty:
  `extraPlugins({ schema })` and the `DocSource` abstraction (default `valueDocSource`).
- **`/rjsf`** — `createRichContentWidget(nodeViewRegistry, defaults?)` producing a component that
  mounts as an RJSF field (object values) or widget: reads `manifest`/`manifestRef` (resolved via
  `formContext.schemaFetcher`, falling back to `defaults.schemaFetcher`), `palette`, and `commit`
  from `ui:options`; assembles `[defaults.baseManifest, profile]`; runs advisory client-side
  validation of the field schema at commit boundaries (server stays authoritative).

```ts
import { assemblePMSchema, generateNodeId } from '@stephenr85/blockdoc/core';

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
3. else (`null`) → `admitsText: true` → content `'inline*'`; otherwise leaf.
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
2. **Only set-union repetition is expressible.** Categories compile to `(a | b)*` —
   sets with unordered, unbounded repetition. PM content expressions can express
   sequences, counts and required children (`outline sections+`, `heading paragraph*`),
   but categories cannot. The real grammar's ordering (`content_article`'s Beats drain
   outline **then** sections, in declaration order) is lost: the derived
   `(outline | section)*` admits an outline anywhere, repeatedly, or never. Ordering /
   arity constraints need the `contentExpression` escape hatch (or a richer manifest
   field later).
3. **Single-category unions are still just repetition.** `["listItem"]` derives
   `(listItem)*` — you cannot say "exactly one" or "at least one" child.
4. **`null` ("unconstrained") is inexpressible in PM.** Server-side, a `null`
   `admitsChildCategories` means "admits anything". PM has no "any" wildcard short of
   enumerating every group, so the derivation compiles `null` to `'inline*'` when
   `admitsText` is set and to a **leaf** otherwise. Real case: `ContentSectionBlock`
   does not override `admitsChildCategories()` (null) and carries its prose as a flat
   `body` **string attr** — compiled faithfully it would be an attrs-only leaf, which is
   useless in an editor. The fixture instead reshapes it for editing: `contentSection`
   admits `["section", "prose"]` and drops the `body` attr in favour of child prose
   nodes (keeping `heading`, `groundingTokens`, `imagePrompt`, `strategy`). The
   server-side export (issue 06) must own this reshaping decision — flat-prose attrs vs
   PM child content is a per-block choice, not something the client can infer.
5. **Category `$id`s are not PM-safe tokens.** Real categories are URL `$id`s
   (e.g. `https://app.splicewire.com/json-schemas/block-category/content-section`).
   PM's content-expression tokenizer only accepts word characters, so raw `$id`s cannot
   be PM group names. The fixtures use short tokens (`section`, `outline`, `prose`);
   the export command must emit a stable PM-safe slug per category `$id`, not the raw id.
6. **Name casing.** Server `#[NodeType]` names are snake_case (`content_section`) —
   valid PM names — while the hand-authored fixtures follow PM's camelCase convention
   (`contentSection`, matching `bulletList`/`listItem` in the base set). The export
   command must pick one convention; the client treats names as opaque.

## Fixtures

- `tests/fixtures/base.manifest.json` — the vendored base prose vocabulary
  (paragraph, heading, blockquote, lists, codeBlock, horizontalRule, hardBreak;
  marks strong/em/code/link/annotation). Carries `doc: null` — the profile manifest
  owns the doc.
- `tests/fixtures/content-article.manifest.json` — the `content` profile vocabulary
  mirrored by hand from the server blocks, with the adaptations documented above.

## Development

```sh
npm install
npm test        # vitest
npm run typecheck
```
