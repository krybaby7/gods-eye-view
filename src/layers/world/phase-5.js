import { renderActorCard } from '../../ui/worldActorCard.js';
import {
  renderPeopleHeader,
  renderPeopleTab,
} from '../../ui/worldPeopleTab.js';
import { createPeopleOverlay } from './people.js';

export default {
  header: [renderPeopleHeader],
  overlays: [createPeopleOverlay],
  tabs: [{ id: 'people', render: renderPeopleTab }],
  cards: [{ type: 'actor', label: 'Actor', render: renderActorCard }],
};
