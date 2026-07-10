export interface Order {
  order: string
  from?: string
  to?: string
  id?: string
  text?: string
}

export const GAME_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'scout',
      description: '侦察某个地点，获取敌方情报',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '你的据点 id（城市 gb 或国家 iso_a3）' },
          to: { type: 'string', description: '侦察目标 id' },
          text: { type: 'string', description: '侦察命令文案，可选' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attack',
      description: '攻击敌方据点',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '起点 id（你的据点）' },
          to: { type: 'string', description: '目标 id' },
          text: { type: 'string', description: '战前动员文案，可选' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'defend',
      description: '坚守据点防御',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '防守据点 id' },
          text: { type: 'string', description: '防御令文案，可选' },
        },
        required: ['from'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'declareWar',
      description: '向某势力宣战',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '宣战方据点 id' },
          to: { type: 'string', description: '目标势力 id' },
          text: { type: 'string', description: '宣战檄文，可选' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stopBattle',
      description: '停战：停止指定 battle id 的战斗',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'battle id' },
          text: { type: 'string', description: '停战说明，可选' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stopBattles',
      description: '停战：停止某个势力的所有战斗',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '势力 id（为空则停自己所有）' },
          text: { type: 'string', description: '停战说明，可选' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listBattles',
      description: '列出当前所有战斗',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

export function toolCallToOrder(tool: unknown): Order | null {
  const fn = (tool as { function?: { name?: string; arguments?: string | Record<string, unknown> } }).function;
  const name = fn?.name;
  if (!name) return null;

  let args: Record<string, unknown> = {};
  const raw = fn?.arguments;
  if (typeof raw === 'string') {
    try { args = JSON.parse(raw); } catch { args = {}; }
  } else if (typeof raw === 'object' && raw !== null) {
    args = raw as Record<string, unknown>;
  }

  const order: Order = { order: name };
  if (args.text) order.text = args.text as string;
  if (args.from) order.from = args.from as string;
  if (args.to) order.to = args.to as string;
  if (args.id) order.id = args.id as string;
  return order;
}
