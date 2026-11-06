/** 2D / 3D 视图向家具库拖放暴露的通用接口 */
export interface StageApi {
  /** 屏幕坐标 → 户型坐标（mm）；返回该点每毫米对应的屏幕像素 s，用于幽灵图缩放 */
  dropPoint(clientX: number, clientY: number): { x: number; y: number; s: number } | null;
  /** 视图中心对应的户型坐标（tap 添加家具时使用） */
  centerPoint(): { x: number; y: number };
  /** 适应窗口 */
  fit(): void;
  /** 相对缩放 */
  zoomBy(k: number): void;
  /** 按 1:ratio 比例显示 */
  setRatio?(ratio: number): void;
  /** 取消当前绘制 / 拖拽会话，返回是否确有进行中的会话 */
  cancelEdit?(): boolean;
}
