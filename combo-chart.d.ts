export type TimeValue = number | string | Date;

export type DataPoint =
  | [TimeValue, number | null]
  | { x?: TimeValue; time?: TimeValue; date?: TimeValue; t?: TimeValue; y?: number | null; value?: number | null; v?: number | null };

export type SeriesType = 'area' | 'bar' | 'spline' | 'line';

export interface BaseSeriesOptions {
  name?: string;
  color?: string;
  data?: DataPoint[];
  /** Series with the same key share a Y scale. Defaults: area 0, bar 0, spline 1, line 2. */
  yAxis?: string | number;
  decimals?: number;
  valuePrefix?: string;
  valueSuffix?: string;
  valueFormatter?: (value: number) => string;
}

export interface AreaSeriesOptions extends BaseSeriesOptions {
  lineWidth?: number;
  hoverLineWidth?: number;
  fillOpacity?: number;
  smooth?: boolean;
}

export interface BarSeriesOptions extends BaseSeriesOptions {
  widthRatio?: number;
  maxWidth?: number;
  radius?: number;
  overhang?: number;
}

export interface SplineSeriesOptions extends BaseSeriesOptions {
  lineWidth?: number;
  hoverLineWidth?: number;
  threshold?: number | null;
  negativeColor?: string | null;
}

export interface LineSeriesOptions extends BaseSeriesOptions {
  lineWidth?: number;
  hoverLineWidth?: number;
  markerSize?: number;
}

export type SeriesOptions =
  | ({ type: 'area' } & AreaSeriesOptions)
  | ({ type: 'bar' } & BarSeriesOptions)
  | ({ type: 'spline' } & SplineSeriesOptions)
  | ({ type: 'line' } & LineSeriesOptions);

export interface TooltipPoint {
  series: SeriesOptions;
  name: string;
  value: number | null;
  color: string;
}

export interface TooltipOptions {
  enabled?: boolean;
  distance?: number;
  hideDelay?: number;
  dateFormat?: ((date: Date) => string) | null;
  formatter?: ((ctx: { date: Date; time: number; index: number; points: TooltipPoint[] }) => string) | null;
}

export interface ComboChartOptions {
  height?: number | null;
  xSpacing?: 'category' | 'time';
  utc?: boolean;
  fontFamily?: string;
  plotBorderColor?: string;
  plotBorderWidth?: number;
  cursor?: string;
  animation?: false | { duration: number };
  ariaLabel?: string | null;
  yAxes?: Record<string, { min?: number; max?: number }>;
  tooltip?: TooltipOptions;
  series?: SeriesOptions[];
  area?: AreaSeriesOptions | DataPoint[];
  bar?: BarSeriesOptions | DataPoint[];
  spline?: SplineSeriesOptions | DataPoint[];
  line?: LineSeriesOptions | DataPoint[];
}

declare class ComboChart {
  constructor(target: string | HTMLElement, options?: ComboChartOptions);
  static create(target: string | HTMLElement, options?: ComboChartOptions): ComboChart;
  setSeries(series: SeriesOptions[], redraw?: boolean): this;
  setData(nameOrIndex: string | number, data: DataPoint[]): this;
  update(options: ComboChartOptions): this;
  render(): void;
  destroy(): void;
}

export default ComboChart;
