import React from "react";
import { useAppState, useDispatch } from "../../state/AppStateProvider.tsx";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";

export function DialogHost(): React.ReactElement | null {
  const openCount = useAppState((state) => state.openDialogs.length);
  const dispatch = useDispatch();

  useRoutedInput((_input, key) => {
    if (!key.escape || openCount === 0) return false;
    dispatch({ type: "CLOSE_TOP_DIALOG" });
  }, { id: "dialog-host", priority: FOCUS_PRIORITY.DIALOG, isActive: openCount > 0 });

  return null;
}
