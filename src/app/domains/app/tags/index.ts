// The Tags domain's interface to the rest of the app: the `Tag` vocabulary, the
// API adapter, and the Tag entry control the two transaction forms embed (#141).
// The Tags screen (#140) is routed, not imported, so it is not re-exported here.
export type { Tag } from './data/tag';
export { TagsService } from './data/tags.service';
export { TagField } from './ui/tag-field/tag-field';
