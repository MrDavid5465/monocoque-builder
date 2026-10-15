// Registers Fluent's icon font once, when a shell is imported (as the
// pre-split Denim did), so apps don't call initializeIcons() themselves.
import { initializeIcons } from '@fluentui/react';

initializeIcons();
