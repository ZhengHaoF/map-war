export enum Owner {
  KMT = 'KMT', // 国民政府
  CCP = 'CCP', // 中共苏区
  JPN = 'JPN', // 日本
  NEA = 'NEA', // 东北军
  SHX = 'SHX', // 晋系
  GXC = 'GXC', // 桂系
  SCC = 'SCC', // 川军
  MA = 'MA', // 马家军
  XJ = 'XJ', // 新疆
  TIB = 'TIB', // 西藏
  NEUTRAL = 'NEUTRAL', // 中立/无主
}

/** 政权颜色映射（PixiJS 使用 0xRRGGBB 格式） */
export const OWNER_COLORS: Record<Owner, number> = {
  [Owner.KMT]: 0x3b82f6, // 蓝色 - 国民政府
  [Owner.CCP]: 0xef4444, // 红色 - 中共苏区
  [Owner.JPN]: 0xa855f7, // 紫色 - 日本
  [Owner.NEA]: 0x6b7280, // 灰色 - 东北军
  [Owner.SHX]: 0xf97316, // 橙色 - 晋系
  [Owner.GXC]: 0x22c55e, // 绿色 - 桂系
  [Owner.SCC]: 0xca8a04, // 黄褐 - 川军
  [Owner.MA]: 0x06b6d4, // 青色 - 马家军
  [Owner.XJ]: 0x92400e, // 棕色 - 新疆
  [Owner.TIB]: 0xeab308, // 金色 - 西藏
  [Owner.NEUTRAL]: 0x888888,
}

/** 政权中文名 */
export const OWNER_LABELS: Record<Owner, string> = {
  [Owner.KMT]: '国民政府',
  [Owner.CCP]: '中共苏区',
  [Owner.JPN]: '日本关东军',
  [Owner.NEA]: '东北军',
  [Owner.SHX]: '晋系',
  [Owner.GXC]: '桂系',
  [Owner.SCC]: '川军',
  [Owner.MA]: '马家军',
  [Owner.XJ]: '新疆',
  [Owner.TIB]: '西藏',
  [Owner.NEUTRAL]: '中立',
}

export interface OwnerDetail {
  fullName: string
  capital: string
  leader: string
  strength: string
  description: string
}

export const OWNER_DETAILS: Record<string, OwnerDetail> = {
  [Owner.KMT]: {
    fullName: '中华民国国民政府',
    capital: '南京',
    leader: '蒋介石',
    strength: '兵力约 170 万，中央军 30 个师',
    description:
      '名义上统一全国的正统政权，控制华东、华中富裕地区。但内部宁粤分裂、军阀阳奉阴违，外有日本虎视眈眈。攘外必先安内——是先剿共还是先抗日，存亡只在一念之间。',
  },
  [Owner.CCP]: {
    fullName: '中华苏维埃共和国',
    capital: '瑞金',
    leader: '毛泽东 / 朱德',
    strength: '红军约 4 万，民兵不计',
    description:
      '在江西山区建立的红色政权，正在经历国民党第三次围剿。装备简陋但士气高昂，土地革命深得贫苦农民拥护。星星之火能否燎原，取决于能否在围剿中活下来。',
  },
  [Owner.JPN]: {
    fullName: '大日本帝国关东军',
    capital: '旅顺（关东州）',
    leader: '本庄繁',
    strength: '关东军约 2 万精锐，海空军绝对优势',
    description:
      '盘踞中国东北的日本精锐部队，装备精良、训练有素。1931 年 9 月 18 日，南满铁路的一声爆炸将改变一切。东北已是囊中之物，但南下还是北上？帝国的命运赌在这场冒险上。',
  },
  [Owner.NEA]: {
    fullName: '东北边防军',
    capital: '沈阳',
    leader: '张学良',
    strength: '约 30 万，海空军齐全，兵工厂完备',
    description:
      '奉系旧部的继承者，坐拥东北三省最完整的工业体系和亚洲最大的沈阳兵工厂。但少帅张学良年轻气盛，与日本关东军摩擦不断。九一八之夜后，是抵抗还是撤退？三十万大军何去何从。',
  },
  [Owner.SHX]: {
    fullName: '太原绥靖公署（晋系）',
    capital: '太原',
    leader: '阎锡山',
    strength: '晋绥军约 15 万',
    description:
      '经营山西二十年的"山西王"，精于实业建设与政治平衡。中原大战失败后势力收缩，但仍牢牢掌控山西。北有日军觊觎华北，东有中央军虎视，守成还是进取？两个鸡蛋上跳舞，一步都不能错。',
  },
  [Owner.GXC]: {
    fullName: '国民革命军第四集团军（桂系）',
    capital: '南宁',
    leader: '李宗仁 / 白崇禧',
    strength: '桂军约 10 万，以小博大善打硬仗',
    description:
      '民风剽悍的广西将领，虽兵少但战力公认冠绝全国。李白组合一文一武，曾两次北伐、数败蒋介石而不倒。偏安西南一隅，但志在天下。下一个北伐，何时再起？',
  },
  [Owner.SCC]: {
    fullName: '四川各路军阀（川军）',
    capital: '成都 / 重庆',
    leader: '刘湘 / 刘文辉等',
    strength: '川军合计约 30 万，但派系林立，各自为政',
    description:
      '天府之国，却是军阀混战的修罗场。二刘争川、防区割据，大小军阀据守一方，内战比外战打得还凶。谁能先整合四川，谁就能获得逐鹿中原的最强后勤基地。',
  },
  [Owner.MA]: {
    fullName: '西北马家军（甘宁青联军）',
    capital: '西宁',
    leader: '马步芳 / 马鸿逵',
    strength: '回族骑兵约 5 万，机动性极强',
    description:
      '世代盘踞西北的回族武装，骑兵凶悍、信仰凝聚，在高原戈壁上不可战胜。名义上归顺国民政府，实则独立王国。但南下入川还是东进夺陕？马刀所指，便是疆土。',
  },
  [Owner.XJ]: {
    fullName: '新疆边防督办公署',
    capital: '迪化（今乌鲁木齐）',
    leader: '金树仁',
    strength: '省军不足 2 万，防务空虚',
    description:
      '远离中原的边疆省，地广人稀、民族复杂。三区暗流涌动，苏联在边境虎视眈眈。中原大战无力西顾，这广袤的西域正在滑向失控边缘。谁能稳住这六分之一国土？',
  },
  [Owner.TIB]: {
    fullName: '噶厦政府（西藏地方）',
    capital: '拉萨',
    leader: '十三世达赖喇嘛',
    strength: '藏军约 1 万，凭天险据守',
    description:
      '雪域高原上的政教合一政权，东有川军觊觎、南有英印渗透。十三世达赖喇嘛圆寂在即，权力暗流涌动。是回归清廷旧约还是独立自主？站在世界屋脊上，风往何处吹？',
  },
}
