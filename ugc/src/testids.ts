// The single source of data-testid strings, imported by components AND by the
// Playwright specs so a rename cannot silently break a selector.

export const TID = {
  projectList: 'project-list',
  newProjectButton: 'new-project',
  projectTitleInput: 'project-title',
  productName: 'product-name',
  productCategory: 'product-category',
  productDescription: 'product-description',
  productSellingPoint: 'product-selling-point',
  productAddPoint: 'product-add-point',
  productCreate: 'product-create',

  canvas: 'ugc-canvas',
  node: (id: string) => `node-${id}`,
  nodeRun: (id: string) => `node-run-${id}`,
  nodeStatus: (id: string) => `node-status-${id}`,
  handleOut: (id: string) => `handle-out-${id}`,
  handleIn: (id: string) => `handle-in-${id}`,
  band: (id: string) => `band-${id}`,

  panel: 'inspector-panel',
  panelInputs: 'panel-inputs',
  panelSlotRow: (slot: string) => `panel-slot-${slot}`,
  panelUnlink: (slot: string) => `panel-unlink-${slot}`,
  panelField: (id: string) => `panel-field-${id}`,
  panelApprove: 'panel-approve',
  panelApproved: 'panel-approved',
  panelOutput: 'panel-output',
  panelUpload: 'panel-upload',

  voiceList: 'voice-list',
  voiceCard: (id: string) => `voice-card-${id}`,
  voiceCloneTab: 'voice-clone-tab',
  voiceCloneName: 'voice-clone-name',
  voiceCloneFile: 'voice-clone-file',
  voiceCloneStart: 'voice-clone-start',

  runAll: 'run-all',
  runMenu: 'run-menu',
  runFromHere: 'run-from-here',
  runTillHere: 'run-till-here',
  runAgain: 'run-again',
  creditsMeter: 'credits-meter',
  creditsTotal: 'credits-total',
  paletteAdd: (kind: string) => `palette-add-${kind}`,
  toast: 'toast',
} as const;
