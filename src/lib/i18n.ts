import type { FloorPlanData } from '../types';

const NAMES_EN: Record<string, string> = {
  主卧室: 'Master Bedroom', 主卫浴: 'Master Bath', 小孩房: "Kids' Room", 客卫浴: 'Guest Bath', 洗衣阳台: 'Laundry Balcony',
  子女房: "Children's Room", 厨房: 'Kitchen', 餐厅: 'Dining', 过道: 'Hallway', 客厅: 'Living Room', 休闲阳台: 'Leisure Balcony',
  主卧飘窗: 'Master Bay Window', 子女房飘窗: "Children's Bay Window",
  橡木地板: 'Oak Flooring', 胡桃木地板: 'Walnut Flooring', '800 地砖': '800 Tile', '600 地砖': '600 Tile', 大理石: 'Marble',
  '300 防滑砖': '300 Anti-slip Tile', 水磨石: 'Terrazzo', 满铺地毯: 'Wall-to-wall Carpet',
  '双人床 1.8m': 'Double Bed 1.8m', '双人床 1.5m': 'Double Bed 1.5m', 双人床: 'Double Bed', 单人床: 'Single Bed', 婴儿床: 'Crib',
  床头柜: 'Nightstand', 衣柜: 'Wardrobe', 小衣柜: 'Small Wardrobe', 梳妆台: 'Dresser', 书桌: 'Desk', 椅子: 'Chair',
  书架: 'Bookshelf', 飘窗垫: 'Bay Cushion', 三人沙发: '3-Seat Sofa', 双人沙发: 'Loveseat', 转角沙发: 'Corner Sofa',
  单人沙发: 'Armchair', 懒人沙发: 'Beanbag', 茶几: 'Coffee Table', 边几: 'Side Table', 电视柜: 'TV Stand', 地毯: 'Rug',
  鞋柜: 'Shoe Cabinet', 玄关柜: 'Entry Cabinet', 落地灯: 'Floor Lamp', 绿植: 'Plant', 大绿植: 'Large Plant',
  餐桌: 'Dining Table', 六人餐桌: '6-Seat Dining Table', 圆桌: 'Round Table', 餐椅: 'Dining Chair', 岛台: 'Kitchen Island',
  吧椅: 'Bar Stool', 橱柜台面: 'Kitchen Counter', 燃气灶: 'Gas Stove', 水槽: 'Sink', 冰箱: 'Fridge', 餐边柜: 'Sideboard',
  马桶: 'Toilet', 浴室柜: 'Vanity', 双盆浴室柜: 'Double Vanity', 淋浴房: 'Shower', 淋浴区: 'Shower Area', 浴缸: 'Bathtub',
  洗衣机: 'Washer', 洗衣池: 'Laundry Sink', 电热水器: 'Water Heater', 储物柜: 'Storage Cabinet', '65 寸电视': '65" TV',
  '55 寸电视': '55" TV', 对开门冰箱: 'French-door Fridge', 柜机空调: 'Floor AC', 挂机空调: 'Wall AC', 洗碗机: 'Dishwasher',
  蒸烤箱高柜: 'Oven Tower', 烘干机: 'Dryer', 空气净化器: 'Air Purifier', 长书桌: 'Long Desk', 办公椅: 'Office Chair',
  大书架: 'Large Bookshelf', 立式钢琴: 'Upright Piano', 跑步机: 'Treadmill', 阅读椅: 'Reading Chair', 茶桌: 'Tea Table', 休闲椅: 'Lounge Chair',
};

export type Lang = 'zh' | 'en';
export const LANGS: Lang[] = ['zh', 'en'];

export function createI18n(lang: Lang) {
  const t = (zh: string, en: string) => (lang === 'en' ? en : zh);
  const nm = (zh: string) => (lang === 'en' ? NAMES_EN[zh] ?? zh : zh);
  /** 房间名：优先使用房间自身的英文名 */
  const rn = (r: { name: string; nameEn?: string }) =>
    (lang === 'en' ? (r.nameEn || NAMES_EN[r.name] || r.name) : r.name);
  return { lang, t, nm, rn };
}

export type I18n = ReturnType<typeof createI18n>;

/** 家具库名称的英文映射一次性并入 NAMES_EN */
export function registerPlanNames(plan: FloorPlanData) {
  plan.catalog.forEach((c) => {
    NAMES_EN[c.name] ??= c.nameEn;
    c.items.forEach((i) => { NAMES_EN[i.name] ??= i.nameEn; });
  });
  plan.rooms.forEach((r) => { NAMES_EN[r.name] ??= r.nameEn; });
  plan.initialFurniture.forEach((f) => {
    const hit = plan.catalog.flatMap((c) => c.items).find((i) => i.name === f.name);
    if (hit) NAMES_EN[f.name] ??= hit.nameEn;
  });
}
