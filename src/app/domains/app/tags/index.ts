// The Tags domain's interface to the rest of the app: the `Tag` vocabulary and
// the API adapter. There is no UI in this slice — the screen is #140 and the
// entry control on the two transaction forms is #141.
export type { Tag } from './data/tag';
export { TagsService } from './data/tags.service';
