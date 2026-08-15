/**
 * Per-pane cell-id namespacing for GraphCanvas, factored out so both the
 * component (src/components/GraphCanvas.tsx) and the chat-command layer
 * (chat-commands.ts) can address the same cells without collisions when
 * multiple panes share one CellGraph (see LinkedGraphPanes.tsx).
 */

// Deliberately NOT namespaced by cellId: linked panes share one CellGraph,
// and scrubbing/playing one pane's timeline should drive every pane's curve
// off the same clock.
export const TIME_CELL = "time";

export function cellIds(cellId: string) {
  return {
    expr: `expr:${cellId}`,
    freeVars: `freeVars:${cellId}`,
    params: `params:${cellId}`,
    path: `path:${cellId}`,
    pointX: `pointX:${cellId}`,
    point: `point:${cellId}`,
    exact: `exact:${cellId}`,
    structure: `structure:${cellId}`,
    scatter: `scatter:${cellId}`,
    derivative: `derivative:${cellId}`,
    // Curve-analysis overlays (issue #28): exact numeric f'(x) at the
    // draggable point, and local-maxima/minima markers over the plotted path.
    pointDerivative: `pointDerivative:${cellId}`,
    extrema: `extrema:${cellId}`,
    timelineDuration: `timelineDuration:${cellId}`,
    regionMask: `regionMask:${cellId}`,
    areaLower: `areaLower:${cellId}`,
    areaUpper: `areaUpper:${cellId}`,
    area: `area:${cellId}`,
    param: (name: string) => `param:${cellId}:${name}`,
    track: (name: string) => `track:${cellId}:${name}`,
  };
}

export type CellIds = ReturnType<typeof cellIds>;

/**
 * Cell-id namespacing for a 3D surface pane (Graph3DCanvas.tsx) -- a
 * deliberately smaller set than `cellIds`: no `point`/`exact`/`scatter`/
 * `derivative`/`structure`, since dragging a curve point, exact-mode
 * readouts, finite-structure scatter, and the derivative accordion are all
 * single-axis-variable 2D concepts that don't have a 3D analog here yet.
 */
export function cellIds3D(cellId: string) {
  return {
    expr: `expr3d:${cellId}`,
    freeVars: `freeVars3d:${cellId}`,
    params: `params3d:${cellId}`,
    mesh: `mesh3d:${cellId}`,
    timelineDuration: `timelineDuration3d:${cellId}`,
    param: (name: string) => `param3d:${cellId}:${name}`,
    track: (name: string) => `track3d:${cellId}:${name}`,
  };
}

export type CellIds3D = ReturnType<typeof cellIds3D>;

export function cellIdsParametricSurface(cellId: string) {
  return {
    exprX: `paramSurfExprX:${cellId}`,
    exprY: `paramSurfExprY:${cellId}`,
    exprZ: `paramSurfExprZ:${cellId}`,
    uMin: `paramSurfUMin:${cellId}`,
    uMax: `paramSurfUMax:${cellId}`,
    vMin: `paramSurfVMin:${cellId}`,
    vMax: `paramSurfVMax:${cellId}`,
    mesh: `paramSurfMesh:${cellId}`,
  };
}

export type CellIdsParametricSurface = ReturnType<typeof cellIdsParametricSurface>;

/**
 * Cell-id namespacing for a system-of-equations solver panel
 * (SystemSolverPanel.tsx) -- a different input shape entirely from
 * `cellIds`'s single expression + axis variable (N equation strings + N
 * variable names), so it gets its own small, purpose-specific set rather
 * than reusing/extending `cellIds`.
 */
export function cellIdsSystem(cellId: string) {
  return {
    equations: `sysEquations:${cellId}`,
    variables: `sysVariables:${cellId}`,
    solution: `sysSolution:${cellId}`,
  };
}

export type CellIdsSystem = ReturnType<typeof cellIdsSystem>;

/**
 * Cell-id namespacing for the statistics/probability panel
 * (StatisticsPanel.tsx) -- another different input shape (a raw data-value
 * list plus separate distribution-query parameters), so like
 * `cellIdsSystem` it gets its own small, purpose-specific set.
 */
export function cellIdsStatistics(cellId: string) {
  return {
    data: `statsData:${cellId}`,
    summary: `statsSummary:${cellId}`,
    distType: `statsDistType:${cellId}`,
    distMean: `statsDistMean:${cellId}`,
    distSd: `statsDistSd:${cellId}`,
    distN: `statsDistN:${cellId}`,
    distP: `statsDistP:${cellId}`,
    distLambda: `statsDistLambda:${cellId}`,
    distDf: `statsDistDf:${cellId}`,
    queryLower: `statsQueryLower:${cellId}`,
    queryUpper: `statsQueryUpper:${cellId}`,
    query: `statsQuery:${cellId}`,
    // Inference section (issue #37) -- deliberately NOT part of the
    // persisted StatisticsState/URL-hash schema (v1, unchanged) since
    // these are additive fields; they reset to sane defaults on reload
    // rather than forcing a schema version bump. Still full CellGraph
    // cells, so they're agent-visible via useCellGraphTools regardless.
    testType: `statsTestType:${cellId}`,
    testMu0: `statsTestMu0:${cellId}`,
    testDataB: `statsTestDataB:${cellId}`,
    testExpected: `statsTestExpected:${cellId}`,
    testAlpha: `statsTestAlpha:${cellId}`,
    testResult: `statsTestResult:${cellId}`,
    // Smoothing section (issue #56) -- same "not part of the persisted
    // schema" convention as the inference-section fields above.
    smoothingKernelType: `statsSmoothingKernelType:${cellId}`,
    smoothingWidth: `statsSmoothingWidth:${cellId}`,
    smoothingShowResidual: `statsSmoothingShowResidual:${cellId}`,
    smoothingResult: `statsSmoothingResult:${cellId}`,
  };
}

export type CellIdsStatistics = ReturnType<typeof cellIdsStatistics>;

/**
 * Cell-id namespacing for the ODE solver/slope-field panel (OdePanel.tsx) --
 * a two-variable f(x,y) expression plus an initial condition and a
 * rectangular domain, yet another shape distinct from `cellIds`'s
 * single-axis-variable model, so it gets its own small set like
 * `cellIdsSystem`/`cellIdsStatistics`.
 */
export function cellIdsOde(cellId: string) {
  return {
    expr: `odeExpr:${cellId}`,
    x0: `odeX0:${cellId}`,
    y0: `odeY0:${cellId}`,
    xMin: `odeXMin:${cellId}`,
    xMax: `odeXMax:${cellId}`,
    yMin: `odeYMin:${cellId}`,
    yMax: `odeYMax:${cellId}`,
    solution: `odeSolution:${cellId}`,
    slopeField: `odeSlopeField:${cellId}`,
    closedForm: `odeClosedForm:${cellId}`,
  };
}

/**
 * Cell-id namespacing for the coupled-ODE-system/phase-portrait panel
 * (OdeSystemPanel.tsx) -- a fixed 2-equation/2-variable system (dx/dt,
 * dy/dt) plus an initial condition, a t-domain, and a phase-plane viewport.
 * Fixed at 2 equations/2 variables for v1, the same scope cut
 * SystemSolverPanel (its algebraic-system counterpart) already made.
 */
export function cellIdsOdeSystem(cellId: string) {
  return {
    exprX: `odeSysExprX:${cellId}`,
    exprY: `odeSysExprY:${cellId}`,
    t0: `odeSysT0:${cellId}`,
    x0: `odeSysX0:${cellId}`,
    y0: `odeSysY0:${cellId}`,
    tMin: `odeSysTMin:${cellId}`,
    tMax: `odeSysTMax:${cellId}`,
    xMin: `odeSysXMin:${cellId}`,
    xMax: `odeSysXMax:${cellId}`,
    yMin: `odeSysYMin:${cellId}`,
    yMax: `odeSysYMax:${cellId}`,
    trajectory: `odeSysTrajectory:${cellId}`,
    vectorField: `odeSysVectorField:${cellId}`,
    // Fixed-point classification (issue #29) -- derived from the same
    // exprX/exprY/xMin..yMax/t0 cells above, no new inputs needed.
    fixedPoints: `odeSysFixedPoints:${cellId}`,
  };
}

export type CellIdsOdeSystem = ReturnType<typeof cellIdsOdeSystem>;

export type CellIdsOde = ReturnType<typeof cellIdsOde>;

export function cellIdsOde2(cellId: string) {
  return {
    a: `ode2A:${cellId}`,
    b: `ode2B:${cellId}`,
    c: `ode2C:${cellId}`,
    x0: `ode2X0:${cellId}`,
    y0: `ode2Y0:${cellId}`,
    yPrime0: `ode2YPrime0:${cellId}`,
    xMin: `ode2XMin:${cellId}`,
    xMax: `ode2XMax:${cellId}`,
    yMin: `ode2YMin:${cellId}`,
    yMax: `ode2YMax:${cellId}`,
    solution: `ode2Solution:${cellId}`,
    closedForm: `ode2ClosedForm:${cellId}`,
  };
}

export type CellIdsOde2 = ReturnType<typeof cellIdsOde2>;

export function cellIdsTaylor(cellId: string) {
  return {
    expr: `taylorExpr:${cellId}`,
    center: `taylorCenter:${cellId}`,
    order: `taylorOrder:${cellId}`,
    xMin: `taylorXMin:${cellId}`,
    xMax: `taylorXMax:${cellId}`,
    yMin: `taylorYMin:${cellId}`,
    yMax: `taylorYMax:${cellId}`,
    limitPoint: `taylorLimitPoint:${cellId}`,
    limitDirection: `taylorLimitDirection:${cellId}`,
    fPath: `taylorFPath:${cellId}`,
    taylorPath: `taylorPolyPath:${cellId}`,
    taylorLatex: `taylorPolyLatex:${cellId}`,
    limitResult: `taylorLimitResult:${cellId}`,
  };
}

export type CellIdsTaylor = ReturnType<typeof cellIdsTaylor>;

export function cellIdsSeries(cellId: string) {
  return {
    exprText: `seriesExprText:${cellId}`,
    variable: `seriesVariable:${cellId}`,
    fromN: `seriesFromN:${cellId}`,
    toN: `seriesToN:${cellId}`,
    plotCount: `seriesPlotCount:${cellId}`,
    result: `seriesResult:${cellId}`,
  };
}

export type CellIdsSeries = ReturnType<typeof cellIdsSeries>;

export function cellIdsFourier(cellId: string) {
  return {
    waveType: `fourierWaveType:${cellId}`,
    harmonics: `fourierHarmonics:${cellId}`,
    samples: `fourierSamples:${cellId}`,
  };
}

export type CellIdsFourier = ReturnType<typeof cellIdsFourier>;

export function cellIdsMonteCarlo(cellId: string) {
  return {
    seed: `mcSeed:${cellId}`,
    dartCount: `mcDartCount:${cellId}`,
    dartResult: `mcDartResult:${cellId}`,
    distType: `mcDistType:${cellId}`,
    distMean: `mcDistMean:${cellId}`,
    distSd: `mcDistSd:${cellId}`,
    distA: `mcDistA:${cellId}`,
    distB: `mcDistB:${cellId}`,
    distRate: `mcDistRate:${cellId}`,
    distN: `mcDistN:${cellId}`,
    distP: `mcDistP:${cellId}`,
    distLambda: `mcDistLambda:${cellId}`,
    sampleCount: `mcSampleCount:${cellId}`,
    histResult: `mcHistResult:${cellId}`,
    integrandText: `mcIntegrandText:${cellId}`,
    integrandA: `mcIntegrandA:${cellId}`,
    integrandB: `mcIntegrandB:${cellId}`,
    integrandSampleCount: `mcIntegrandSampleCount:${cellId}`,
    integrandResult: `mcIntegrandResult:${cellId}`,
  };
}

export type CellIdsMonteCarlo = ReturnType<typeof cellIdsMonteCarlo>;

export function cellIdsMatrix(cellId: string) {
  return {
    matrixText: `matrixText:${cellId}`,
    determinant: `matrixDeterminant:${cellId}`,
    inverse: `matrixInverse:${cellId}`,
    rref: `matrixRref:${cellId}`,
    decompositions: `matrixDecompositions:${cellId}`,
    polyCoeffs: `matrixPolyCoeffs:${cellId}`,
    polyRoots: `matrixPolyRoots:${cellId}`,
  };
}

export type CellIdsMatrix = ReturnType<typeof cellIdsMatrix>;

export function cellIdsDiscrete(cellId: string) {
  return {
    groupKind: `discreteGroupKind:${cellId}`,
    groupN: `discreteGroupN:${cellId}`,
    groupInfo: `discreteGroupInfo:${cellId}`,
    gcdA: `discreteGcdA:${cellId}`,
    gcdB: `discreteGcdB:${cellId}`,
    gcdResult: `discreteGcdResult:${cellId}`,
    factorizeN: `discreteFactorizeN:${cellId}`,
    factorizeResult: `discreteFactorizeResult:${cellId}`,
    crtText: `discreteCrtText:${cellId}`,
    crtResult: `discreteCrtResult:${cellId}`,
  };
}

export type CellIdsDiscrete = ReturnType<typeof cellIdsDiscrete>;

export function cellIdsGraphTheory(cellId: string) {
  return {
    edgeListText: `graphEdgeListText:${cellId}`,
    directed: `graphDirected:${cellId}`,
    graphResult: `graphParseResult:${cellId}`,
    analysis: `graphAnalysis:${cellId}`,
    startVertex: `graphStartVertex:${cellId}`,
    endVertex: `graphEndVertex:${cellId}`,
    algorithm: `graphAlgorithm:${cellId}`,
    algorithmResult: `graphAlgorithmResult:${cellId}`,
  };
}

export type CellIdsGraphTheory = ReturnType<typeof cellIdsGraphTheory>;

export function cellIdsComplex(cellId: string) {
  return {
    exprText: `complexExprText:${cellId}`,
    parseResult: `complexParseResult:${cellId}`,
    probeRe: `complexProbeRe:${cellId}`,
    probeIm: `complexProbeIm:${cellId}`,
    probeResult: `complexProbeResult:${cellId}`,
    showRootsOfUnity: `complexShowRootsOfUnity:${cellId}`,
    rootsN: `complexRootsN:${cellId}`,
    rootsResult: `complexRootsResult:${cellId}`,
    showConformalGrid: `complexShowConformalGrid:${cellId}`,
    conformalGridType: `complexConformalGridType:${cellId}`,
    conformalGridSpacing: `complexConformalGridSpacing:${cellId}`,
    conformalGridResult: `complexConformalGridResult:${cellId}`,
  };
}

export type CellIdsComplex = ReturnType<typeof cellIdsComplex>;

export function cellIdsSignal(cellId: string) {
  return {
    exprText: `signalExprText:${cellId}`,
    sampleRate: `signalSampleRate:${cellId}`,
    duration: `signalDuration:${cellId}`,
    waveformResult: `signalWaveformResult:${cellId}`,
    spectrumResult: `signalSpectrumResult:${cellId}`,
    nperseg: `signalNperseg:${cellId}`,
    noverlap: `signalNoverlap:${cellId}`,
    spectrogramResult: `signalSpectrogramResult:${cellId}`,
    showPeaks: `signalShowPeaks:${cellId}`,
    minAmplitude: `signalMinAmplitude:${cellId}`,
    minSpacingHz: `signalMinSpacingHz:${cellId}`,
    minProminence: `signalMinProminence:${cellId}`,
    peaksResult: `signalPeaksResult:${cellId}`,
  };
}

export type CellIdsSignal = ReturnType<typeof cellIdsSignal>;

export function cellIdsImageFrequency(cellId: string) {
  return {
    pattern: `imageFreqPattern:${cellId}`,
    size: `imageFreqSize:${cellId}`,
    maskType: `imageFreqMaskType:${cellId}`,
    radius: `imageFreqRadius:${cellId}`,
    radius2: `imageFreqRadius2:${cellId}`,
    result: `imageFreqResult:${cellId}`,
  };
}

export type CellIdsImageFrequency = ReturnType<typeof cellIdsImageFrequency>;

export function cellIdsGradientDescent(cellId: string) {
  return {
    exprText: `gdExprText:${cellId}`,
    startX: `gdStartX:${cellId}`,
    startY: `gdStartY:${cellId}`,
    lr: `gdLr:${cellId}`,
    steps: `gdSteps:${cellId}`,
    showSgd: `gdShowSgd:${cellId}`,
    showAdam: `gdShowAdam:${cellId}`,
    showRmsprop: `gdShowRmsprop:${cellId}`,
    useSchedule: `gdUseSchedule:${cellId}`,
    stepSize: `gdStepSize:${cellId}`,
    gamma: `gdGamma:${cellId}`,
    contoursResult: `gdContoursResult:${cellId}`,
    descentResults: `gdDescentResults:${cellId}`,
  };
}

export type CellIdsGradientDescent = ReturnType<typeof cellIdsGradientDescent>;

export function cellIdsMlPlayground(cellId: string) {
  return {
    dataset: `mlDataset:${cellId}`,
    pointsPerClass: `mlPointsPerClass:${cellId}`,
    dataSeed: `mlDataSeed:${cellId}`,
    modelSeed: `mlModelSeed:${cellId}`,
    hidden: `mlHidden:${cellId}`,
    lr: `mlLr:${cellId}`,
    epochs: `mlEpochs:${cellId}`,
    points: `mlPoints:${cellId}`,
  };
}

export type CellIdsMlPlayground = ReturnType<typeof cellIdsMlPlayground>;

// Deliberately NOT namespaced by cellId, same reasoning as TIME_CELL: every
// expression row on a GraphCanvasMulti shares one coordinate system and one
// ordered row list, rather than each owning an independent viewport the way
// LinkedGraphPanes's side-by-side panes do.
export const VIEWPORT_CELL = "viewport";
export const EXPRESSION_LIST_CELL = "expressionList";

/**
 * Cell-id namespacing for one row on a shared multi-expression canvas
 * (GraphCanvasMulti.tsx/ExpressionRow.tsx) -- deliberately a smaller set
 * than `cellIds`: v1 covers the curve itself, its color/visibility,
 * free-variable sliders, an optional f' overlay curve (sharing the row's
 * own color, dashed), per-row area-under-curve shading (#51), a
 * step-by-step differentiation trace, inequality region shading, and now
 * (#51's last item) finite-structure scatter mode, but not yet the
 * single-pane `GraphCanvas`'s point-drag feature, which stays
 * single-expression-only for now. Exact-mode evaluation (#107) is shared across the whole
 * panel instead of per-row, so it lives on GraphCanvasMulti's own
 * MODE_CELL, not here -- the differentiation trace, by contrast, is both
 * computed AND displayed per-row: each row owns an independent local
 * `showSteps` toggle (plain `useState`, not a cell -- see
 * ExpressionRow.tsx), so any number of rows
 * can have their trace accordion open at once, with no cross-row
 * mutual-exclusion mechanism.
 */
export function cellIdsMultiRow(cellId: string) {
  return {
    expr: `multiExpr:${cellId}`,
    color: `multiColor:${cellId}`,
    visible: `multiVisible:${cellId}`,
    freeVars: `multiFreeVars:${cellId}`,
    params: `multiParams:${cellId}`,
    /** Strict-variables mode (see Symbolic.assertVariables): when on, any variable besides the axis variable is a hard error rather than an auto-inferred slider. */
    strict: `multiStrict:${cellId}`,
    /** {ok:true,path} | {ok:false,message} -- the single source both `path` (falls back to the last good path) and `error` (surfaces the message) read from. */
    pathResult: `multiPathResult:${cellId}`,
    path: `multiPath:${cellId}`,
    error: `multiError:${cellId}`,
    roots: `multiRoots:${cellId}`,
    /** Every gap (singularity/domain boundary) in the sampled path -- see findDiscontinuities. */
    discontinuities: `multiDiscontinuities:${cellId}`,
    /** Whether the f' overlay curve is toggled on for this row. */
    showDerivative: `multiShowDerivative:${cellId}`,
    /** The sampled f' curve (same color as `path`, drawn dashed), or null while `showDerivative` is off. Falls back to the last good sample on a mid-typing parse error, like `path` does. */
    derivativePath: `multiDerivativePath:${cellId}`,
    /** Whether this row's area-under-curve shading (issue #51) is toggled on. Per-row, unlike GraphCanvas's single shared area -- each curve gets its own bounds/fill. */
    showArea: `multiShowArea:${cellId}`,
    areaLower: `multiAreaLower:${cellId}`,
    areaUpper: `multiAreaUpper:${cellId}`,
    /** `{value, path} | null` -- null while `showArea` is off, matching `derivativePath`'s "off costs nothing" convention. */
    area: `multiArea:${cellId}`,
    /** The step-by-step differentiation trace (issue #51): unconditionally computed, like GraphCanvas's own `ids.derivative` -- a single differentiate pass is cheap, so there's no "off" gate here. Display is gated by each row's own local `showSteps` toggle in ExpressionRow.tsx, independent per row. */
    derivative: `multiDerivative:${cellId}`,
    /** 1D inequality shading (issue #51), mirroring GraphCanvas's own `ids.regionMask`: null unless this row's top-level expression is a `cmp` node (e.g. "sin(x) < cos(x)"), so a plain function row costs nothing extra. No "off" toggle -- entirely driven by what the row's expression parses as, same as the single-pane version. */
    regionMask: `multiRegionMask:${cellId}`,
    /** Finite-structure modulus (issue #51), mirroring GraphCanvas's own `ids.structure`: null selects the reals (the default, continuous curve); set to n, this row plots over Z/nZ instead. */
    structure: `multiStructure:${cellId}`,
    /** All (x,y) pairs of this row's expression evaluated over its `structure` (Z/nZ), or null while `structure` is null. When populated, GraphCanvasMulti draws ONLY this scatter for the row -- no continuous path, no region/area shading, matching GraphCanvas's own "scatter replaces everything else" branching, since none of those overlays have meaning over a finite structure. */
    scatter: `multiScatter:${cellId}`,
    param: (name: string) => `multiParam:${cellId}:${name}`,
  };
}

export type CellIdsMultiRow = ReturnType<typeof cellIdsMultiRow>;

/**
 * Cell-id namespacing for one graph block on the reactive notebook surface
 * (NotebookPanel.tsx/NotebookGraphBlock.tsx). Unlike GraphCanvasMulti, where
 * every row shares one `VIEWPORT_CELL`/`EXPRESSION_LIST_CELL` by design,
 * multiple independent notebook graph blocks now live on one shared
 * `CellGraph` (so a later block can reference an earlier one's value --
 * see `notebookValueCellId` below) and would otherwise collide on those two
 * unnamespaced constants. Each block's own rows still use `cellIdsMultiRow`
 * unchanged -- row ids are already `crypto.randomUUID()`, so they don't
 * collide across blocks.
 */
export function cellIdsNotebookBlock(blockId: string) {
  return {
    viewport: `notebookViewport:${blockId}`,
    expressionList: `notebookExpressionList:${blockId}`,
  };
}

export type CellIdsNotebookBlock = ReturnType<typeof cellIdsNotebookBlock>;

/**
 * A notebook "value" block's cell, keyed by its user-given `name` rather
 * than its block id -- this is what makes cross-referencing registry-free:
 * a graph block's free variable `k` resolves to this cell via a plain
 * `graph.hasValue(notebookValueCellId("k"))` check, with no separate
 * name -> block-id lookup needed. A rename simply starts a new cell under
 * the new name; the old name's cell is left as a harmless orphan (matches
 * this codebase's existing tolerance for orphaned cells on removal, e.g.
 * GraphCanvasMulti's `removeRow` doesn't clean up a removed row's cells
 * either).
 */
export function notebookValueCellId(name: string): string {
  return `notebookValue:${name}`;
}

/**
 * Cell-id namespacing for the implicit-curve panel (ImplicitPanel.tsx) -- a
 * two-variable relation plus a rectangular domain, yet another shape
 * distinct from `cellIds`'s single-axis-variable model.
 */
export function cellIdsImplicit(cellId: string) {
  return {
    expr: `implicitExpr:${cellId}`,
    xMin: `implicitXMin:${cellId}`,
    xMax: `implicitXMax:${cellId}`,
    yMin: `implicitYMin:${cellId}`,
    yMax: `implicitYMax:${cellId}`,
    segments: `implicitSegments:${cellId}`,
    // Contour/gradient-field overlays (issue #28's remaining scope) --
    // reuse the same relation field, converted to a bare f(x,y) via
    // equationToImplicitZero, as their underlying scalar field.
    showContours: `implicitShowContours:${cellId}`,
    contourResult: `implicitContourResult:${cellId}`,
    showGradient: `implicitShowGradient:${cellId}`,
    gradientResult: `implicitGradientResult:${cellId}`,
  };
}

export type CellIdsImplicit = ReturnType<typeof cellIdsImplicit>;

/**
 * Cell-id namespacing for the parametric/polar panel (ParametricPanel.tsx):
 * either x(t)/y(t) expressions, or a single r(θ) expression converted to
 * x=r·cosθ, y=r·sinθ internally -- one mode flag, one pair of component
 * expressions (reused for whichever mode is active), a t/θ domain, and a
 * resolution.
 */
export function cellIdsParametric(cellId: string) {
  return {
    mode: `paramMode:${cellId}`,
    exprX: `paramExprX:${cellId}`,
    exprY: `paramExprY:${cellId}`,
    exprR: `paramExprR:${cellId}`,
    tMin: `paramTMin:${cellId}`,
    tMax: `paramTMax:${cellId}`,
    path: `paramPath:${cellId}`,
  };
}

export type CellIdsParametric = ReturnType<typeof cellIdsParametric>;

/**
 * Cell-id namespacing for the regression panel (RegressionPanel.tsx) -- one
 * ordered row list (each row a spreadsheet-style {id, x, y}), a fit-type
 * toggle, and (for the nonlinear fit) a model expression plus a map of
 * per-parameter initial guesses -- distinct from every other panel's shape.
 */
export function cellIdsRegression(cellId: string) {
  return {
    rows: `regressionRows:${cellId}`,
    fitType: `regressionFitType:${cellId}`,
    modelExpr: `regressionModelExpr:${cellId}`,
    paramGuesses: `regressionParamGuesses:${cellId}`,
    fit: `regressionFit:${cellId}`,
  };
}

export type CellIdsRegression = ReturnType<typeof cellIdsRegression>;

/**
 * Cell-id namespacing for one geometry construction (GeometryPanel.tsx),
 * used both by the standalone page (fixed cellId "geo-1") and a notebook-
 * embedded geometry block (cellId = the block's own id) -- so multiple
 * constructions can share one `CellGraph` without one's point/line/etc.
 * list clobbering another's. Only the two *list* cells need namespacing
 * here, unlike every other per-instance cellIds* factory: every individual
 * object cell (point/line/circle/...) is already keyed by its own
 * `crypto.randomUUID()` object id, which is globally unique regardless of
 * which construction created it -- collisions can only happen on the
 * shared "which objects exist" list, the same reasoning
 * `cellIdsNotebookBlock` above applies to a graph block's
 * viewport/expressionList (its *rows*, in contrast, reuse `cellIdsMultiRow`
 * unnamespaced by block, for the identical reason).
 */
export function cellIdsGeometry(cellId: string) {
  return {
    objectList: `geomObjects:${cellId}`,
    opsLog: `geomOpsLog:${cellId}`,
  };
}

export type CellIdsGeometry = ReturnType<typeof cellIdsGeometry>;
