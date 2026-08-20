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
    // Pan/zoom (issue #53's remaining scope): `viewport` is the committed,
    // sampled-against viewport; `liveViewport` is a mid-gesture-only
    // override for a zero-resample redraw during a wheel/drag/pinch --
    // same VIEWPORT_CELL/LIVE_VIEWPORT_CELL split GraphCanvasMulti's #52/
    // #103 already established, just namespaced per-pane here since
    // GraphCanvas (unlike Multi) supports several independent panes
    // sharing one CellGraph (LinkedGraphPanes.tsx).
    viewport: `viewport:${cellId}`,
    liveViewport: `liveViewport:${cellId}`,
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
 *
 * Unlimited overlaid surfaces (#336 item 7): `list` (the ordered row-id
 * list) and `combinedTimelineDuration` (Math.max across every row's own
 * `timelineDuration`, for the one shared transport widget to scrub the full
 * length of whichever row's animation is longest -- same shape
 * Linked3DView's own `COMBINED_DURATION_CELL` already established, just
 * generalized from 2 fixed panes to N rows) are container-level, called
 * with the panel's own container id. Every other field -- `expr`/
 * `freeVars`/`params`/`mesh`/`timelineDuration`/`color`/`visible`/`param`/
 * `track` -- is per-row, called with a row id: one z=f(x,y) surface per
 * row, each with its own expression, free-variable sliders/keyframe
 * tracks, sampled mesh, and own-animation duration. Same "same factory,
 * container id vs. row id" split cellIdsParametricSurface/
 * cellIdsComplexGraph3D already use.
 */
export function cellIds3D(cellId: string) {
  return {
    expr: `expr3d:${cellId}`,
    freeVars: `freeVars3d:${cellId}`,
    params: `params3d:${cellId}`,
    mesh: `mesh3d:${cellId}`,
    timelineDuration: `timelineDuration3d:${cellId}`,
    color: `color3d:${cellId}`,
    visible: `visible3d:${cellId}`,
    param: (name: string) => `param3d:${cellId}:${name}`,
    track: (name: string) => `track3d:${cellId}:${name}`,
    list: `list3d:${cellId}`,
    combinedTimelineDuration: `combinedTimelineDuration3d:${cellId}`,
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
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `paramSurfColor:${cellId}`,
    visible: `paramSurfVisible:${cellId}`,
    list: `paramSurfList:${cellId}`,
  };
}

export type CellIdsParametricSurface = ReturnType<typeof cellIdsParametricSurface>;

export function cellIdsVectorField3D(cellId: string) {
  return {
    exprDx: `vectorField3dExprDx:${cellId}`,
    exprDy: `vectorField3dExprDy:${cellId}`,
    exprDz: `vectorField3dExprDz:${cellId}`,
    xMin: `vectorField3dXMin:${cellId}`,
    xMax: `vectorField3dXMax:${cellId}`,
    yMin: `vectorField3dYMin:${cellId}`,
    yMax: `vectorField3dYMax:${cellId}`,
    zMin: `vectorField3dZMin:${cellId}`,
    zMax: `vectorField3dZMax:${cellId}`,
    points: `vectorField3dPoints:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `vectorField3dColor:${cellId}`,
    visible: `vectorField3dVisible:${cellId}`,
    list: `vectorField3dList:${cellId}`,
  };
}

export type CellIdsVectorField3D = ReturnType<typeof cellIdsVectorField3D>;

export function cellIdsSpaceCurve(cellId: string) {
  return {
    exprX: `spaceCurveExprX:${cellId}`,
    exprY: `spaceCurveExprY:${cellId}`,
    exprZ: `spaceCurveExprZ:${cellId}`,
    tMin: `spaceCurveTMin:${cellId}`,
    tMax: `spaceCurveTMax:${cellId}`,
    points: `spaceCurvePoints:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `spaceCurveColor:${cellId}`,
    visible: `spaceCurveVisible:${cellId}`,
    list: `spaceCurveList:${cellId}`,
  };
}

export type CellIdsSpaceCurve = ReturnType<typeof cellIdsSpaceCurve>;

/**
 * #345/#24-followup: unlimited complex-graph functions sharing one set of
 * screen axes. `axisX`/`axisY`/`axisZ`/`list` are panel-level (call with
 * the container id, never a row id) -- the axis assignment is a shared
 * "view" every function is plotted against, same reasoning as why
 * VectorField3DPanel's domain bounds stay container-level while its
 * expressions go per-row. `yExpr`/`tMin`/`tMax`/`color`/`visible`/`points`
 * are per-row (see cellIdsImplicit's doc comment for the "same factory,
 * container id vs. row id" split).
 */
export function cellIdsComplexGraph3D(cellId: string) {
  return {
    yExpr: `complexGraph3dYExpr:${cellId}`,
    tMin: `complexGraph3dTMin:${cellId}`,
    tMax: `complexGraph3dTMax:${cellId}`,
    points: `complexGraph3dPoints:${cellId}`,
    color: `complexGraph3dColor:${cellId}`,
    visible: `complexGraph3dVisible:${cellId}`,
    axisX: `complexGraph3dAxisX:${cellId}`,
    axisY: `complexGraph3dAxisY:${cellId}`,
    axisZ: `complexGraph3dAxisZ:${cellId}`,
    // Explicit "sweep even if unassigned" domain toggles (#365) --
    // container-level, alongside axisX/Y/Z, not per-row: see
    // complex-graph-state.ts's ComplexGraphStateV3 doc comment for why.
    sweepReX: `complexGraph3dSweepReX:${cellId}`,
    sweepImX: `complexGraph3dSweepImX:${cellId}`,
    // Near-real scatter-point highlight toggle (#367) -- container-level,
    // same reasoning as sweepReX/sweepImX above.
    highlightNearReal: `complexGraph3dHighlightNearReal:${cellId}`,
    list: `complexGraph3dList:${cellId}`,
  };
}

export type CellIdsComplexGraph3D = ReturnType<typeof cellIdsComplexGraph3D>;

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
 *
 * Unlimited independent datasets (#336 item 7): unlike every other
 * multi-row panel's own port, StatisticsPanel has no natural "shared
 * viewport/canvas to overlay N rows on" -- summary stats, distribution
 * query, hypothesis test, and kernel smoothing are each a small text/canvas
 * output tied to ONE dataset. So `list` is the ONLY container-level field
 * (called with the panel's own container id, the ordered list of dataset
 * ids every dataset lives under) -- every other field below, including the
 * inference/smoothing fields that are deliberately NOT part of the
 * persisted schema (see their own note just below), is per-dataset (called
 * with a dataset id): each dataset gets its own data string, distribution
 * params, query, hypothesis test, smoothing state, color, and visibility.
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
    // persisted StatisticsState/URL-hash schema (v2, unchanged by the
    // unlimited-datasets port) since these are additive fields; they reset
    // to sane defaults on reload rather than forcing a schema version bump.
    // Still full CellGraph cells, so they're agent-visible via
    // useCellGraphTools regardless.
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
    // Unlimited independent datasets (#336 item 7): color/visible are
    // per-dataset; list is container-level (see this function's own doc
    // comment).
    color: `statsColor:${cellId}`,
    visible: `statsVisible:${cellId}`,
    list: `statsList:${cellId}`,
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
    // Unlimited expressions (#336 item 7, mirroring cellIdsOde2's identical
    // split): xMin/xMax/yMin/yMax/list are container-level (called with the
    // panel's own container id, shared by every row); color/visible are
    // per-row (called with a row id). expr/x0/y0/solution/slopeField/
    // closedForm above are ALSO per-row now -- one initial-value problem per
    // row, each with its own f(x,y).
    color: `odeColor:${cellId}`,
    visible: `odeVisible:${cellId}`,
    list: `odeList:${cellId}`,
  };
}

/**
 * Cell-id namespacing for the coupled-ODE-system/phase-portrait panel
 * (OdeSystemPanel.tsx) -- a fixed 2-equation/2-variable system per row
 * (dx/dt, dy/dt) plus an initial condition and a t-domain. Fixed at 2
 * equations/2 variables PER SYSTEM, the same scope cut SystemSolverPanel
 * (its algebraic-system counterpart) already made.
 *
 * Unlimited overlaid systems (same port as cellIdsOde/cellIdsSpaceCurve):
 * xMin/xMax/yMin/yMax/list are container-level (called with the panel's own
 * container id, shared by every row) -- the phase-plane viewport is a
 * shared "view" every system's trajectory is plotted against, same
 * reasoning as why VectorField3DPanel's domain bounds stay container-level
 * while its expressions go per-row. exprX/exprY/t0/x0/y0/tMin/tMax/color/
 * visible/trajectory/vectorField/fixedPoints are all per-row (called with a
 * row id) -- one coupled system per row, each with its own f(x,y)/g(x,y),
 * initial condition, and t-domain.
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
    color: `odeSysColor:${cellId}`,
    visible: `odeSysVisible:${cellId}`,
    list: `odeSysList:${cellId}`,
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
    // Pan/zoom (issue #53): same shape as TaylorPanel (#189) -- xMin/xMax/
    // yMin/yMax above ARE the viewport, already reactive. `liveViewport`
    // only overrides those four for a zero-resample mid-gesture redraw.
    // Called with the panel's own container id (shared across every row),
    // unlike a/b/c/x0/y0/yPrime0/solution/closedForm above.
    liveViewport: `ode2LiveViewport:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `ode2Color:${cellId}`,
    visible: `ode2Visible:${cellId}`,
    list: `ode2List:${cellId}`,
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
    // Pan/zoom (issue #53): unlike GraphCanvas/FourierPanel, there's no
    // separate committed-viewport cell -- `xMin`/`xMax`/`yMin`/`yMax` above
    // ARE the viewport, already reactive (taylorPath's compute already
    // reads them, so committing a gesture there gets the resample for
    // free). `liveViewport` only overrides those four for a zero-resample
    // mid-gesture redraw, same convention as every other panel. Called with
    // the panel's own container id (shared across every row), unlike
    // expr/center/order/limitPoint/limitDirection/taylorPath/limitResult
    // above.
    liveViewport: `taylorLiveViewport:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `taylorColor:${cellId}`,
    visible: `taylorVisible:${cellId}`,
    list: `taylorList:${cellId}`,
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
    // Pan/zoom (issue #53): unlike fourierViewport, `result`'s partial-sum
    // scatter points don't depend on the viewport at all (every n in
    // [from,to] is always computed, regardless of what's currently in
    // view) -- viewport here is pure display framing, not a resample
    // driver. The live/committed split is kept anyway for consistency
    // with every other pan/zoom panel in this app (GraphCanvas #184,
    // FourierPanel #188, ...), not because it saves any real work here.
    // Called with the panel's own container id (shared across every row),
    // unlike exprText/variable/fromN/toN/plotCount/result above.
    viewport: `seriesViewport:${cellId}`,
    liveViewport: `seriesLiveViewport:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id) -- see cellIdsImplicit's doc comment for the "same
    // factory, container id vs. row id" split.
    color: `seriesColor:${cellId}`,
    visible: `seriesVisible:${cellId}`,
    list: `seriesList:${cellId}`,
  };
}

export type CellIdsSeries = ReturnType<typeof cellIdsSeries>;

export function cellIdsFourier(cellId: string) {
  return {
    waveType: `fourierWaveType:${cellId}`,
    harmonics: `fourierHarmonics:${cellId}`,
    samples: `fourierSamples:${cellId}`,
    // Pan/zoom (issue #53): unlike ParametricPanel, `samples` is computed
    // directly over the viewport's own x-range (sampleFourierPartialSum
    // reads VIEWPORT.xMin/xMax), so panning past the original domain needs
    // a real resample -- `viewport` is read reactively inside `samples`'s
    // compute body, same GraphCanvas (#184) pattern.
    viewport: `fourierViewport:${cellId}`,
    liveViewport: `fourierLiveViewport:${cellId}`,
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
    showEditor: `graphShowEditor:${cellId}`,
    edgeWeight: `graphEdgeWeight:${cellId}`,
    /** vertex label -> data-space {x,y}, editor-placed positions only (issue #24's interactive editor). Auxiliary/ephemeral, not URL-coded -- same convention as MlPlaygroundPanel's drawnPoints. */
    vertexPositions: `graphVertexPositions:${cellId}`,
    /** Whether the current algorithm result plays back step by step on the shared TIME_CELL clock (issue #24's remaining scope: "step-by-step algorithm animation") instead of revealing the whole result at once. */
    showAnimation: `graphShowAnimation:${cellId}`,
    /** Derived `AlgorithmStep[]` for the current algorithm result -- see graph-algorithm-steps.ts. */
    algorithmSteps: `graphAlgorithmSteps:${cellId}`,
  };
}

export type CellIdsGraphTheory = ReturnType<typeof cellIdsGraphTheory>;

/**
 * Unlimited independent functions (#336 item 7): domain coloring is a
 * per-pixel raster of ONE function -- you cannot overlay two different
 * domain colorings on one canvas, unlike the "unlimited overlaid rows on a
 * shared plot" panels (RegressionPanel/OdeSystemPanel). So the solution
 * mirrors StatisticsPanel's own unlimited-datasets port instead: `list` is
 * the ONLY container-level field (called with the panel's own container
 * id, the ordered list of function ids every function lives under) --
 * every other field below, including `param` (a function field, skipped
 * by multi-panel-rows.ts's own `removeRow` per its doc comment) and the
 * viewport/liveViewport pair, is per-function (called with a function id):
 * each function gets its own expression, probe point, roots-of-unity/
 * conformal-grid/zeros/poles overlay state, pan/zoom viewport, color, and
 * visibility.
 */
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
    showZeros: `complexShowZeros:${cellId}`,
    zerosResult: `complexZerosResult:${cellId}`,
    showPoles: `complexShowPoles:${cellId}`,
    polesResult: `complexPolesResult:${cellId}`,
    freeVars: `complexFreeVars:${cellId}`,
    params: `complexParams:${cellId}`,
    param: (name: string) => `complexParam:${cellId}:${name}`,
    // Pan/zoom (issue #53, z-plane only -- w-plane keeps its own
    // `autoFitViewport` derived reactively off `conformalGridResult`, which
    // itself reads this committed viewport, so it re-fits automatically on
    // every z-plane gesture commit with no separate wiring). `zerosResult`/
    // `polesResult`/`rootsResult` deliberately do NOT read this viewport --
    // those are intrinsic features of f(z) itself (found once over a fixed
    // default analysis domain), not properties of the current framing, so
    // panning/zooming moves them on screen without recomputing their values.
    viewport: `complexViewport:${cellId}`,
    liveViewport: `complexLiveViewport:${cellId}`,
    // Unlimited independent functions (#336 item 7): color/visible are
    // per-function; list is container-level (see this function's own doc
    // comment).
    color: `complexColor:${cellId}`,
    visible: `complexVisible:${cellId}`,
    list: `complexList:${cellId}`,
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
    showCorrelation: `signalShowCorrelation:${cellId}`,
    exprTextB: `signalExprTextB:${cellId}`,
    waveformBResult: `signalWaveformBResult:${cellId}`,
    correlationResult: `signalCorrelationResult:${cellId}`,
    showResample: `signalShowResample:${cellId}`,
    resampleUp: `signalResampleUp:${cellId}`,
    resampleDown: `signalResampleDown:${cellId}`,
    resampleResult: `signalResampleResult:${cellId}`,
    useBuilder: `signalUseBuilder:${cellId}`,
    builderTerms: `signalBuilderTerms:${cellId}`,
    showFilter: `signalShowFilter:${cellId}`,
    filterType: `signalFilterType:${cellId}`,
    filterOrder: `signalFilterOrder:${cellId}`,
    filterCutoffHz: `signalFilterCutoffHz:${cellId}`,
    // Only read/shown for bandpass/bandstop (issue #90's unblock): the
    // filter's high cutoff, `filterCutoffHz` doubling as the LOW cutoff
    // for those two types (matches designFilter's own [low, high] pair).
    filterCutoffHzHigh: `signalFilterCutoffHzHigh:${cellId}`,
    filterResult: `signalFilterResult:${cellId}`,
    filteredWaveformResult: `signalFilteredWaveformResult:${cellId}`,
    bodeResult: `signalBodeResult:${cellId}`,
    psdBeforeResult: `signalPsdBeforeResult:${cellId}`,
    psdAfterResult: `signalPsdAfterResult:${cellId}`,
    /** Live-microphone toggle (issue #204's v1 pilot). Deliberately NOT part of the persisted URL schema -- always defaults off on load, even from a shared link, matching the design's own "never silently request mic access on page load" decision. */
    liveMic: `signalLiveMic:${cellId}`,
    /** The most recently sampled live-mic Waveform, or null before the first sample arrives -- auxiliary/ephemeral like ImageFrequencyPanel's uploadedGrid, for the same reason (can't live in the URL hash). waveformResult reads this INSTEAD of sampling exprText while liveMic is on. */
    liveWaveformOverride: `signalLiveWaveformOverride:${cellId}`,
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
    wedgeAngle: `imageFreqWedgeAngle:${cellId}`,
    wedgeWidth: `imageFreqWedgeWidth:${cellId}`,
    result: `imageFreqResult:${cellId}`,
    uploadedGrid: `imageFreqUploadedGrid:${cellId}`,
    paintedMask: `imageFreqPaintedMask:${cellId}`,
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
    // SGD momentum/Nesterov (issue #33's last remaining item, unblocked
    // by johnhenry/mallory-plus#89) -- only shown/read when SGD is one of
    // the racing optimizers, applied uniformly to every SGD run.
    momentum: `gdMomentum:${cellId}`,
    nesterov: `gdNesterov:${cellId}`,
    contoursResult: `gdContoursResult:${cellId}`,
    descentResults: `gdDescentResults:${cellId}`,
    surfaceMesh: `gdSurfaceMesh:${cellId}`,
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
    dropout: `mlDropout:${cellId}`,
    points: `mlPoints:${cellId}`,
    drawnPoints: `mlDrawnPoints:${cellId}`,
    /** Issue #253's CSV-import dataset (`dataset: "csv"`): points handed off from DataImportPanel's "Open in ML" action, seeded from the decoded URL state (unlike drawnPoints, which is never URL-persisted -- see ml-playground-state.ts's own doc comment on csvPoints). */
    csvPoints: `mlCsvPoints:${cellId}`,
    /** Issue #253: display names for csvPoints' label indices (cosmetic legend only, see ml-playground-state.ts). */
    classNames: `mlClassNames:${cellId}`,
    useSchedule: `mlUseSchedule:${cellId}`,
    stepSize: `mlStepSize:${cellId}`,
    gamma: `mlGamma:${cellId}`,
    isTraining: `mlIsTraining:${cellId}`,
    /** Issue #34 item 2: one live-updated cell per mallory-telemetry metric name, written by the run's own setSink handler mid-training so an agent (or the panel itself) can observe an in-progress run reactively, not just the final result. */
    metric: (name: string) => `mlMetric:${name}:${cellId}`,
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
    /** Local maxima/minima on the sampled path (issue #50's generated-description input) -- see findCurveExtrema, GraphCanvas's own `ids.extrema` counterpart. */
    extrema: `multiExtrema:${cellId}`,
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
    /** User-given name (issue #35 item 2) under which this row publishes its `path` cell for cross-block reference -- see `notebookCurveCellId`. Empty string means "not published." Only meaningful on the notebook surface; a plain GraphCanvasMulti row leaves this cell unread. */
    curveName: `multiCurveName:${cellId}`,
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
 * A workspace variable's cell, keyed by its user-given `name` (issue #42) --
 * the app-global counterpart to `notebookValueCellId`, same registry-free
 * convention: a panel's free variable `k` resolves to this cell via a plain
 * `graph.hasValue(workspaceValueCellId("k"))` check against the singleton
 * workspace `CellGraph` (see `workspace-graph.ts`), not a separate name ->
 * panel lookup. Unlike the notebook's per-document graph, this is the SAME
 * cell no matter which page reads or writes it.
 */
export function workspaceValueCellId(name: string): string {
  return `workspace:${name}`;
}

/**
 * A notebook graph row's published curve (issue #35 item 2), keyed by its
 * user-given name -- the whole-curve counterpart to `notebookValueCellId`
 * above, same registry-free convention: a curve-transform block reads this
 * cell directly via `graph.get(notebookCurveCellId(name))` (registering the
 * dependency even before the name exists) then branches on `hasValue`,
 * exactly like `ExpressionRow`'s free-variable lookup does for scalars. The
 * publishing row `graph.define()`s this cell as a passthrough to its own
 * `path` cell (see `cellIdsMultiRow`'s `curveName`) rather than `set()`ing a
 * snapshot, so it stays live across viewport-driven resampling.
 */
export function notebookCurveCellId(name: string): string {
  return `notebookCurve:${name}`;
}

export type CurveTransformOp = "derivative" | "integral" | "difference";

/** Cell-id namespacing for a "curve transform" notebook block (issue #35 item 2). `curveName2` is only read/shown for the `"difference"` op (the second curve, subtracted from `curveName`'s). */
export function cellIdsCurveTransform(blockId: string) {
  return {
    curveName: `curveTransformName:${blockId}`,
    curveName2: `curveTransformName2:${blockId}`,
    op: `curveTransformOp:${blockId}`,
    result: `curveTransformResult:${blockId}`,
  };
}

export type CellIdsCurveTransform = ReturnType<typeof cellIdsCurveTransform>;

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
    // Interval-subdivision robust mode (issue #21, item 1) -- a guaranteed-
    // coverage enclosure overlay, drawn alongside (not replacing) the
    // marching-squares curve above.
    showIntervalBoxes: `implicitShowIntervalBoxes:${cellId}`,
    intervalBoxesResult: `implicitIntervalBoxesResult:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row
    // (called with a row id, one per relation); `list` is the panel-level
    // ordered row-id list (called with the panel's own container id, same
    // "same factory, different id purpose" convention `list`/`viewport`-
    // style cells use elsewhere in this file) -- see ImplicitPanel.tsx's
    // own doc comment for the shared-viewport/per-row-relation split.
    color: `implicitColor:${cellId}`,
    visible: `implicitVisible:${cellId}`,
    list: `implicitList:${cellId}`,
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
    // Pan/zoom (issue #53): unlike GraphCanvas, `path` is sampled purely
    // over the t/theta domain above, never the x/y viewport -- so panning
    // and zooming here are pure re-renders with zero resampling, and
    // `liveViewport` exists only to skip a redundant commit write on every
    // pointermove tick, not to avoid a resample. Shared across every row
    // (called with the panel's own container id) -- see cellIdsImplicit's
    // doc comment for the "same factory, container id vs. row id" split.
    viewport: `paramViewport:${cellId}`,
    liveViewport: `paramLiveViewport:${cellId}`,
    // Unlimited expressions (issue #251): `color`/`visible` are per-row;
    // `list` is the panel-level ordered row-id list (called with the
    // container id).
    color: `paramColor:${cellId}`,
    visible: `paramVisible:${cellId}`,
    list: `paramList:${cellId}`,
  };
}

export type CellIdsParametric = ReturnType<typeof cellIdsParametric>;

/**
 * Cell-id namespacing for the regression panel (RegressionPanel.tsx) -- one
 * ordered dataset list, each dataset its own spreadsheet-style row of (x, y)
 * points, a fit-type toggle, and (for the nonlinear fit) a model expression
 * plus a map of per-parameter initial guesses -- distinct from every other
 * panel's shape.
 *
 * Unlimited overlaid datasets (#336 item 7, same port as
 * cellIdsOde/cellIdsSpaceCurve): `list` is container-level (called with the
 * panel's own container id, shared by every dataset) -- the ordered list of
 * dataset ids every dataset lives under. `points`/`fitType`/`modelExpr`/
 * `paramGuesses`/`fit`/`linearLossMode`/`showOutliers`/`huberFitting`/
 * `huberFitResult`/`color`/`visible` are all per-dataset (called with a
 * dataset id) -- one (x, y) point list and fit per dataset, each with its
 * own fit-type/model/loss-mode/outlier/Huber state and its own color/
 * visibility. Named `points` (not `rows`) to avoid colliding with the
 * "dataset" vocabulary this port introduces at the panel level -- the
 * pre-existing "row" name already meant one spreadsheet (x, y) data point,
 * one level BELOW a dataset.
 */
export function cellIdsRegression(cellId: string) {
  return {
    points: `regressionPoints:${cellId}`,
    fitType: `regressionFitType:${cellId}`,
    modelExpr: `regressionModelExpr:${cellId}`,
    paramGuesses: `regressionParamGuesses:${cellId}`,
    fit: `regressionFit:${cellId}`,
    // Robust (Huber-loss) linear fit, issue #34 item 3 -- a separate,
    // imperatively-triggered result (async `trainer.fit`, so it can't be a
    // reactive `graph.define` compute; see robust-regression.ts's own doc
    // comment). `huberFitResult` is null until the "Fit (Huber)" button has
    // run at least once.
    linearLossMode: `regressionLinearLossMode:${cellId}`,
    showOutliers: `regressionShowOutliers:${cellId}`,
    huberFitting: `regressionHuberFitting:${cellId}`,
    huberFitResult: `regressionHuberFitResult:${cellId}`,
    color: `regressionColor:${cellId}`,
    visible: `regressionVisible:${cellId}`,
    list: `regressionList:${cellId}`,
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

/**
 * Cell-id namespacing for the Wang tile laboratory (TilesPanel.tsx, issue
 * #92 M1). `solveSteps`/`solveGrid`/`solveStatus` are free cells (not
 * `define`d) because solving drains an async generator -- inherently
 * asynchronous work a synchronous `compute` fn can't do -- so a "Solve"
 * action writes the collected result via `graph.set` instead of the usual
 * derive-on-read pattern the rest of this panel's cells use.
 */
export function cellIdsTiles(cellId: string) {
  return {
    tilesText: `tilesText:${cellId}`,
    tileSetResult: `tilesTileSetResult:${cellId}`,
    width: `tilesWidth:${cellId}`,
    height: `tilesHeight:${cellId}`,
    solver: `tilesSolver:${cellId}`,
    showAnimation: `tilesShowAnimation:${cellId}`,
    solveStatus: `tilesSolveStatus:${cellId}`,
    solveSteps: `tilesSolveSteps:${cellId}`,
    solveGrid: `tilesSolveGrid:${cellId}`,
    solveError: `tilesSolveError:${cellId}`,
    // M2 additions (issue #92): symmetry expansion is a `define`d derivation
    // of tileSetResult (pure, synchronous, so unlike solving it CAN use the
    // usual derive-on-read pattern). Entropy is NOT auto-derived -- strip
    // height grows the search combinatorially, so it's computed on demand
    // via a button, with its own status/result/error free cells (same
    // "async-flavored action -> free cells" shape solveStatus/solveGrid/
    // solveError already use, even though stripEntropy itself is
    // synchronous -- the pattern is "on-demand, not auto", not "async").
    symmetry: `tilesSymmetry:${cellId}`,
    expandedTileSetResult: `tilesExpandedTileSetResult:${cellId}`,
    entropyHeight: `tilesEntropyHeight:${cellId}`,
    entropyStatus: `tilesEntropyStatus:${cellId}`,
    entropyResult: `tilesEntropyResult:${cellId}`,
    entropyError: `tilesEntropyError:${cellId}`,
    // Diffraction/autocorrelation (issue #92 M3's square-lattice slice):
    // which solved tile id the two views are computed for, and a `define`d
    // derivation off solveGrid -- pure and synchronous like symmetry
    // expansion, so it derives on read rather than needing its own
    // status/error free cells the way entropy does.
    diffractionTileId: `tilesDiffractionTileId:${cellId}`,
    diffractionResult: `tilesDiffractionResult:${cellId}`,
    // Lattice picker (issue #92 M3's hex/tri generalization). `lattice`
    // selects which of the 3 tile models is active; the other lattices'
    // own tile-set text, solve state, etc. live in SEPARATE cells (not a
    // shared/unioned set) rather than repurposing the square lattice's own
    // cells, since the 3 lattices have genuinely different Tile/TileSet/
    // Grid types and this keeps every cell's stored value type simple and
    // uniform instead of a runtime-tagged union. Symmetry/entropy/
    // diffraction stay square-lattice-only for now -- hex/tri only get
    // tile editing + solving + rendering in this first cut, no
    // step-by-step animation either (their solvers are drained straight to
    // a final grid, matching this scope-down).
    lattice: `tilesLattice:${cellId}`,
    hexTilesText: `tilesHexTilesText:${cellId}`,
    hexTileSetResult: `tilesHexTileSetResult:${cellId}`,
    hexSolveStatus: `tilesHexSolveStatus:${cellId}`,
    hexSolveGrid: `tilesHexSolveGrid:${cellId}`,
    hexSolveError: `tilesHexSolveError:${cellId}`,
    triTilesText: `tilesTriTilesText:${cellId}`,
    triTileSetResult: `tilesTriTileSetResult:${cellId}`,
    triSolveStatus: `tilesTriSolveStatus:${cellId}`,
    triSolveGrid: `tilesTriSolveGrid:${cellId}`,
    triSolveError: `tilesTriSolveError:${cellId}`,
    // Cube lattice (issue #92 M4). `depth` is the cube-only 3rd grid
    // dimension (width/height cover the other two, shared with every other
    // lattice's own cells); otherwise the same "own text/result/solve
    // status/grid/error cells" shape as hex/tri.
    depth: `tilesDepth:${cellId}`,
    cubeTilesText: `tilesCubeTilesText:${cellId}`,
    cubeTileSetResult: `tilesCubeTileSetResult:${cellId}`,
    cubeSolveStatus: `tilesCubeSolveStatus:${cellId}`,
    cubeSolveGrid: `tilesCubeSolveGrid:${cellId}`,
    cubeSolveError: `tilesCubeSolveError:${cellId}`,
    // Differentiable-relaxation experiment (issue #92 M5, square-lattice
    // only). Run on demand via a button, not auto-solved -- same "on-demand
    // free cells" shape as entropy (compute-heavy, and unlike entropy's
    // stripEntropy this ALSO doesn't derive from expandedTileSetResult
    // alone, since width/height/steps/lr all matter too), so relaxSteps/
    // relaxLr get their own free cells rather than living in TilesState.
    relaxSteps: `tilesRelaxSteps:${cellId}`,
    relaxLr: `tilesRelaxLr:${cellId}`,
    relaxStatus: `tilesRelaxStatus:${cellId}`,
    relaxResult: `tilesRelaxResult:${cellId}`,
    relaxError: `tilesRelaxError:${cellId}`,
    // Polyomino-supported (multi-cell footprint) tiles (issue #382/#383):
    // square-lattice-only, same `tilesText` field as the unit pipeline
    // above (an `@row,col`-annotated line is a strict syntax extension of
    // the plain `id N E S W` line, so no separate text cell is needed).
    // `compoundTileSetResult` always parses successfully for ordinary
    // unit-only text too, but the panel only takes this SEPARATE solve
    // path when at least one tile has a multi-cell footprint -- see
    // TilesPanel's own `isCompound`. A distinct solve status/steps/grid/
    // error cell set, same on-demand-vs-auto shape as `solveStatus` etc.
    // above, since `solveWangCompound` needs its own step/grid types.
    compoundTileSetResult: `tilesCompoundTileSetResult:${cellId}`,
    compoundSolveStatus: `tilesCompoundSolveStatus:${cellId}`,
    compoundSolveSteps: `tilesCompoundSolveSteps:${cellId}`,
    compoundSolveGrid: `tilesCompoundSolveGrid:${cellId}`,
    compoundSolveError: `tilesCompoundSolveError:${cellId}`,
  };
}

export type CellIdsTiles = ReturnType<typeof cellIdsTiles>;

/**
 * Cell ids for the n-D cellular automata lab (issue #229). Unlike the
 * Wang tile lab's solvers, CA evolution has no combinatorial search --
 * it's a fixed amount of work per cell per generation -- so both
 * `spacetime1d`/`spacetime2d` are plain `define`d derived cells (pure,
 * synchronous, cached until an input changes), not the async-generator +
 * free-cell pattern the tile solvers need.
 */
export function cellIdsCellularAutomata(cellId: string) {
  return {
    dimension: `caDimension:${cellId}`,
    ruleNumber: `caRuleNumber:${cellId}`,
    width1d: `caWidth1d:${cellId}`,
    generations1d: `caGenerations1d:${cellId}`,
    boundary1d: `caBoundary1d:${cellId}`,
    initial1d: `caInitial1d:${cellId}`,
    seed1d: `caSeed1d:${cellId}`,
    customGrid1d: `caCustomGrid1d:${cellId}`,
    spacetime1dResult: `caSpacetime1dResult:${cellId}`,
    bsRule: `caBsRule:${cellId}`,
    width2d: `caWidth2d:${cellId}`,
    height2d: `caHeight2d:${cellId}`,
    generations2d: `caGenerations2d:${cellId}`,
    boundary2d: `caBoundary2d:${cellId}`,
    initial2d: `caInitial2d:${cellId}`,
    seed2d: `caSeed2d:${cellId}`,
    density2d: `caDensity2d:${cellId}`,
    customGrid2d: `caCustomGrid2d:${cellId}`,
    spacetime2dResult: `caSpacetime2dResult:${cellId}`,
    showVoxelView: `caShowVoxelView:${cellId}`,
    rule3d: `caRule3d:${cellId}`,
    width3d: `caWidth3d:${cellId}`,
    height3d: `caHeight3d:${cellId}`,
    depth3d: `caDepth3d:${cellId}`,
    generations3d: `caGenerations3d:${cellId}`,
    boundary3d: `caBoundary3d:${cellId}`,
    seed3d: `caSeed3d:${cellId}`,
    density3d: `caDensity3d:${cellId}`,
    // #389: 3D's own initial2d/customGrid2d equivalent -- see ca-state.ts's
    // CaStateV2 doc comment.
    initial3d: `caInitial3d:${cellId}`,
    customGrid3d: `caCustomGrid3d:${cellId}`,
    spacetime3dResult: `caSpacetime3dResult:${cellId}`,
  };
}

export type CellIdsCellularAutomata = ReturnType<typeof cellIdsCellularAutomata>;
