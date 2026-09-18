/**
 * Componentes base de la consola (docs/DESIGN.md § 4).
 * Uso: `import { Button, Card, StatusDot } from '../ui/index.ts';`
 */
export { default as Badge } from './Badge.vue';
export { default as Button } from './Button.vue';
export { default as Card } from './Card.vue';
export { default as CodeBlock } from './CodeBlock.vue';
export { default as EmptyState } from './EmptyState.vue';
export { default as KeyValue } from './KeyValue.vue';
export { default as PageHeader } from './PageHeader.vue';
export { default as RelativeTime } from './RelativeTime.vue';
export { default as SegmentedControl } from './SegmentedControl.vue';
export { default as Stat } from './Stat.vue';
export { default as StatGrid } from './StatGrid.vue';
export { default as StatusDot } from './StatusDot.vue';
export { default as Tabs } from './Tabs.vue';
export { default as ThemeSwitcher } from './ThemeSwitcher.vue';
export { default as Timeline } from './Timeline.vue';
export { default as TimelineItem } from './TimelineItem.vue';

export type {
  BadgeVariant,
  ButtonSize,
  ButtonVariant,
  KeyValueItem,
  SegmentedOption,
  StatSize,
  StatTone,
  Status,
  TabItem,
} from './types.ts';

export {
  ACTOR_BADGE,
  APPROVAL_STATUS,
  CASE_STATUS,
  DEVICE_STATUS,
  decisionBadge,
  riskPresentation,
  type BadgePresentation,
  type StatusPresentation,
} from './status.ts';

export { THEME_LABEL, THEMES, applySavedTheme, setTheme, useTheme, type Theme, type UseTheme } from './theme.ts';
