import { test, expect } from '@playwright/test';
test.beforeEach(async ({page})=>{await page.goto('/tests/e2e/fixtures/report-followups.html');await page.getByRole('button',{name:'Review report'}).click();});
test('reviews exact defaults without sending, supports edits, individual off and Enter',async({page})=>{
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('submitted')).toBeEmpty();
  await expect(page.getByLabel('Follow-up 1 message')).toContainText('Hi Alex,');
  await page.getByLabel('Follow-up 1 message').fill('Hi Alex, my exact edited text.');
  await page.getByLabel('Follow-up 1 time, London').fill('16:45');
  await page.getByRole('switch',{name:'Enable follow-up 2'}).click();
  await page.getByLabel('Follow-up 1 time, London').press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const items=JSON.parse(await page.getByTestId('submitted').innerText());
  expect(items[0].body).toBe('Hi Alex, my exact edited text.');expect(items[1].enabled).toBe(false);
  const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'}).format(new Date(items[0].scheduled_for));expect(hour).toBe('16:45');
});
test('skip all needs Send report, Escape cancels, and textarea Enter stays a newline',async({page})=>{
  await page.getByRole('button',{name:"Skip follow-ups, I've got it"}).click();
  await expect(page.getByRole('switch',{name:'Enable follow-up 1'})).not.toBeChecked();
  await expect(page.getByTestId('submitted')).toBeEmpty();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Review report'}).click();
  await page.getByLabel('Follow-up 1 message').press('Enter');await expect(page.getByTestId('submitted')).toBeEmpty();
  await page.getByRole('button',{name:"Skip follow-ups, I've got it"}).click();
  await page.getByRole('button',{name:'Send report',exact:true}).click();
  expect(JSON.parse(await page.getByTestId('submitted').innerText()).every((i:any)=>!i.enabled)).toBe(true);
});
test('footer stays on screen on laptop and narrow screens, with focus trapped',async({page})=>{
  const button=page.getByRole('button',{name:'Send report',exact:true});
  let bounds=await button.boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(768);
  await button.focus();await page.keyboard.press('Tab');expect(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.setViewportSize({width:390,height:844});bounds=await button.boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);
});
