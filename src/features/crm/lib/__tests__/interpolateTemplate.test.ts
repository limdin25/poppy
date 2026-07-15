import { describe, it, expect } from 'vitest';
import { interpolateTemplate } from '../interpolateTemplate';

describe('interpolateTemplate', () => {
  it('substitutes {{first_name}} (double brace)', () => {
    expect(
      interpolateTemplate('Hi {{first_name}}, welcome.', {
        firstName: 'Hugo',
        agentFirstName: 'Sam',
      })
    ).toBe('Hi Hugo, welcome.');
  });

  it('substitutes {first_name} (single brace)', () => {
    expect(
      interpolateTemplate('Hi {first_name}, welcome.', {
        firstName: 'Hugo',
        agentFirstName: 'Sam',
      })
    ).toBe('Hi Hugo, welcome.');
  });

  it('substitutes both placeholders together', () => {
    expect(
      interpolateTemplate(
        'Hi {{first_name}}, this is {{agent_first_name}} from Elsie.',
        { firstName: 'Hugo', agentFirstName: 'Sam' }
      )
    ).toBe('Hi Hugo, this is Sam from Elsie.');
  });

  it('drops placeholder when value is missing — does NOT send literal {agent_first_name}', () => {
    const out = interpolateTemplate(
      'Hi {{first_name}}, this is {{agent_first_name}} from Elsie.',
      { firstName: 'Hugo' }
    );
    expect(out).not.toContain('{');
    expect(out).not.toContain('agent_first_name');
  });

  it('drops placeholder when value is empty string', () => {
    const out = interpolateTemplate(
      'Hi {{first_name}}, this is {{agent_first_name}}.',
      { firstName: 'Hugo', agentFirstName: '' }
    );
    expect(out).not.toContain('agent_first_name');
    expect(out).not.toContain('{');
  });

  it('drops placeholder when value is null', () => {
    const out = interpolateTemplate('Hi {first_name}.', {
      firstName: null,
      agentFirstName: null,
    });
    expect(out).not.toContain('first_name');
    expect(out).not.toContain('{');
  });

  it('cleans up trailing comma when value is empty', () => {
    const out = interpolateTemplate('Hi {{first_name}}, welcome.', {
      firstName: '',
      agentFirstName: '',
    });
    // "Hi , welcome." → cleaned to "Hi, welcome."
    expect(out).toBe('Hi, welcome.');
  });

  it('handles multiple occurrences', () => {
    expect(
      interpolateTemplate('{{first_name}} {{first_name}} {first_name}', {
        firstName: 'Hugo',
        agentFirstName: '',
      })
    ).toBe('Hugo Hugo Hugo');
  });

  it('case-insensitive on placeholder name', () => {
    expect(
      interpolateTemplate('Hi {{FIRST_NAME}} / {Agent_First_Name}', {
        firstName: 'Hugo',
        agentFirstName: 'Sam',
      })
    ).toBe('Hi Hugo / Sam');
  });

  it('tolerates whitespace inside braces', () => {
    expect(
      interpolateTemplate('Hi {{ first_name }} / {  agent_first_name  }', {
        firstName: 'Hugo',
        agentFirstName: 'Sam',
      })
    ).toBe('Hi Hugo / Sam');
  });

  it('leaves unrelated text untouched', () => {
    expect(
      interpolateTemplate('Visit {url} for more info', {
        firstName: 'Hugo',
        agentFirstName: 'Sam',
      })
    ).toBe('Visit {url} for more info');
  });
});
