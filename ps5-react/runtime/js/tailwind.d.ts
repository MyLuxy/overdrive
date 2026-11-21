// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Editor types for build-time styling (docs/TAILWIND.md); the build removes className.
import 'embedded-react';

interface ClassNameProps {
  /** Tailwind-style classes compiled to `style` at build time. */
  className?: string;
  /** Read by `focused:` (and its `hover:`/`focus:` aliases). */
  focused?: boolean;
  /** Read by `selected:`. */
  selected?: boolean;
  /** Read by `active:`. */
  active?: boolean;
  /** Read by `checked:`. */
  checked?: boolean;
  /** Read by `pressed:`. */
  pressed?: boolean;
  /** Read by `disabled:`. */
  disabled?: boolean;
}

/** D-pad focus on `View`, `Image`, and `Pressable` from `@ps5-react/core` (docs/NAVIGATION.md). */
interface FocusProps {
  /** Takes part in D-pad navigation; implied by `onPress` and by `Pressable`. */
  focusable?: boolean;
  /** Takes focus when mounted if nothing in its scope has it. */
  autoFocus?: boolean;
  /** Stable id for `focus(key)` and `nextFocus*`. */
  focusKey?: string;
  nextFocusUp?: string;
  nextFocusDown?: string;
  nextFocusLeft?: string;
  nextFocusRight?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** Called on Cross while focused, and on touch. */
interface FocusPressProps {
  onPress?: (event?: {type: 'press'}) => void;
}

declare module 'embedded-react' {
  interface ViewProps extends ClassNameProps, FocusProps, FocusPressProps {}
  interface TextProps extends ClassNameProps {}
  interface ImageProps extends ClassNameProps, FocusProps, FocusPressProps {}
  interface PressableProps extends FocusProps {}
}
