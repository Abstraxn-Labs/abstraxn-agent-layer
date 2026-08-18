import {
  validateArrayLength,
  validateEnum,
  validateExactlyOneOf,
  validateNotPlaceholder,
  validateNumberInRange,
} from './tool-validation.util';

describe('validateNumberInRange', () => {
  it('returns null when the value is absent', () => {
    expect(validateNumberInRange(undefined, 'minRating', 0, 5, '')).toBeNull();
  });

  it('returns null when the value is within range', () => {
    expect(validateNumberInRange(3, 'minRating', 0, 5, '')).toBeNull();
  });

  it('rejects a value outside the range', () => {
    const result = validateNumberInRange(9, 'minRating', 0, 5, ' for action=x');
    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toEqual({
      error: 'minRating must be between 0 and 5 for action=x.',
    });
  });

  it('rejects a non-number value', () => {
    const result = validateNumberInRange('3', 'minRating', 0, 5, '');
    expect(result?.isError).toBe(true);
  });
});

describe('validateEnum', () => {
  const ALLOWED = ['LOW', 'MEDIUM', 'HIGH'] as const;

  it('returns null when the value is absent', () => {
    expect(validateEnum(undefined, 'requiredQuality', ALLOWED, '')).toBeNull();
  });

  it('returns null when the value is allowed', () => {
    expect(validateEnum('HIGH', 'requiredQuality', ALLOWED, '')).toBeNull();
  });

  it('rejects a value not in the allowed set', () => {
    const result = validateEnum('EXTREME', 'requiredQuality', ALLOWED, '');
    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toEqual({
      error: 'requiredQuality must be one of: LOW, MEDIUM, HIGH.',
    });
  });
});

describe('validateArrayLength', () => {
  it('returns null when the value is absent', () => {
    expect(validateArrayLength(undefined, 'includedTypes', 50, '')).toBeNull();
  });

  it('returns null when within the max length', () => {
    expect(validateArrayLength(['a', 'b'], 'includedTypes', 50, '')).toBeNull();
  });

  it('rejects an array longer than maxItems', () => {
    const result = validateArrayLength(
      Array.from({ length: 51 }, (_, i) => String(i)),
      'includedTypes',
      50,
      '',
    );
    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toEqual({
      error: 'includedTypes must be an array with at most 50 items.',
    });
  });

  it('rejects a non-array value', () => {
    const result = validateArrayLength('not-an-array', 'includedTypes', 50, '');
    expect(result?.isError).toBe(true);
  });
});

describe('validateExactlyOneOf', () => {
  it('returns null when exactly one field is present', () => {
    expect(
      validateExactlyOneOf(
        [
          { name: 'address', present: true },
          { name: 'videoId', present: false },
        ],
        '',
      ),
    ).toBeNull();
  });

  it('rejects when none are present', () => {
    const result = validateExactlyOneOf(
      [
        { name: 'address', present: false },
        { name: 'videoId', present: false },
      ],
      ' for action=aerial_view_lookup_video',
    );
    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toEqual({
      error:
        'Provide exactly one of address/videoId for action=aerial_view_lookup_video, not both.',
    });
  });

  it('rejects when both are present', () => {
    const result = validateExactlyOneOf(
      [
        { name: 'address', present: true },
        { name: 'videoId', present: true },
      ],
      '',
    );
    expect(result?.isError).toBe(true);
  });
});

describe('validateNotPlaceholder', () => {
  it.each([
    'PLACEHOLDER_ID',
    'placeholder_id',
    'your-geotiff-id',
    '<geotiff-id>',
    '{{videoId}}',
    'n/a',
    'unknown',
    'asset 123',
  ])('rejects "%s"', (value) => {
    const result = validateNotPlaceholder(value, 'placeId', '');
    expect(result?.isError).toBe(true);
  });

  it.each([
    'ChIJN1t_tDeuEmsRUsoyG83frY4',
    'geotiff_7f3a9c1e',
    'vid_9f8a7b6c2d3e',
    'abc-123_XYZ.789',
  ])('accepts "%s"', (value) => {
    expect(validateNotPlaceholder(value, 'placeId', '')).toBeNull();
  });
});
