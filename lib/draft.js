/**
 * 把决策写成邮件草稿。规矩(2026-08-04 定):
 *  - 禁 em dash
 *  - 不哭穷:不说 budget is limited,按范围出价 "For this scope, we can offer $X."
 *  - 数字只能原样复述决策给的,这里不做任何计算
 */
/** 首触:先手开价。产品句和 scope 全部来自配置注入,模板零产品假设。 */
export function firstTouchEmail({ offer, ctx }) {
  const name = ctx.firstName || 'there';
  const scope = ctx.scope || 'one post covering the product';
  const intro = ctx.productIntro || '';
  return `Hi ${name},

${intro ? intro + '\n\n' : ''}We are lining up paid creator partnerships and would love to work with you. For this scope, ${scope}, we can offer $${offer}. If that works, we can get started this week.

Best,
${ctx.senderName || ''}`.trim();
}

export function draftEmail(decision, ctx) {
  const name = ctx.firstName || 'there';
  const scope = ctx.scope || 'one post covering the product';
  switch (decision.kind) {
    case 'send_ask_rate':
      return `Hi ${name},

Thanks for getting back to us. Could you share your rate for ${scope}? Once we have that we can move quickly on our side.

Best,
${ctx.senderName || ''}`.trim();
    case 'send_counter': {
      const isFinal = decision.template === 'T-3';
      const line = isFinal
        ? `We went back over our numbers, and $${decision.counter} is the most we can do for this scope. If that works for you, we are good to move forward right away.`
        : `For this scope, ${scope}, we can offer $${decision.counter}. If that works, we can get started this week.`;
      return `Hi ${name},

Thanks for the quote. ${line}

Best,
${ctx.senderName || ''}`.trim();
    }
    case 'to_pending_deal':
      return `Hi ${name},

Great, $${decision.agreed} works. We will send over the details and next steps shortly.

Best,
${ctx.senderName || ''}`.trim();
    case 'close_out_of_range':
      return `Hi ${name},

Thanks for sharing your rate. For this scope our range is around $${decision.value < 100 ? Math.round(decision.value/5)*5 : Math.round(decision.value/10)*10}, so it sounds like we are pretty far apart this time. Totally understand, and if that range ever works on your end we would be glad to pick this back up.

Best,
${ctx.senderName || ''}`.trim();
    case 'close_rejected':
      return `Hi ${name},

Totally understood, thanks for considering it. If things change down the road, we would love to revisit.

Best,
${ctx.senderName || ''}`.trim();
    default:
      return null; // wait / wait_brand / needs_human: 不发信
  }
}
