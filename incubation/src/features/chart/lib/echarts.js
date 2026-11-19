// ECharts, tree-shaken to what the Chart window draws (graph-chart-plan
// §2.4 / G5, G6.0): bar, line, scatter and heatmap charts on a canvas, with
// grid, tooltip, legend, zoom, the selection pins (markPoint) and the heat
// matrix's colour scale (visualMap). Loaded on demand (its own chunk).
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkPointComponent, TitleComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, ScatterChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, DataZoomComponent, MarkPointComponent, VisualMapContinuousComponent, CanvasRenderer]);

export default echarts;
