import React from "react";

import { SetupWizard } from "./SetupWizard.tsx";

interface QuickStartWizardProps {
  onComplete: () => void;
}

export function QuickStartWizard({ onComplete }: QuickStartWizardProps): React.ReactElement {
  return <SetupWizard mode="quickstart" onComplete={onComplete} />;
}

export default QuickStartWizard;
