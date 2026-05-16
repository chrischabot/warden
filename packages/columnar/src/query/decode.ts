/**
 * Page decoder.
 *
 * Dispatches `(encoding_tag, column_type) → typed values`. The
 * encoding tag in the page header tells us which decoder to use
 * directly; the column type from the footer disambiguates the
 * "Raw" encoding (which can carry Int32, Uint32, Int64, or Float64).
 */

import {
  decodeDeltaForInt32,
  decodeRawFloat64,
  decodeRawInt32,
  decodeRawInt64,
  decodeRawUint32,
  decodeRleInt32,
  decodeStringDictionary,
} from '../encodings/index';
import { ColumnTypeId, type ColumnTypeIdValue } from '../segment/types';
import { type EncodedColumn, EncodingTag } from '../types';
import type { ColumnArray } from './types';

export function decodePage(encoded: EncodedColumn, columnType: ColumnTypeIdValue): ColumnArray {
  switch (encoded.tag) {
    case EncodingTag.Raw:
      return decodeRaw(encoded, columnType);
    case EncodingTag.Dictionary:
      if (columnType !== ColumnTypeId.String) {
        throw new RangeError(
          `decodePage: Dictionary encoding requires String column, got type ${columnType}`,
        );
      }
      return decodeStringDictionary(encoded.bytes, encoded.count);
    case EncodingTag.RunLength:
      if (columnType !== ColumnTypeId.Int32) {
        throw new RangeError(
          `decodePage: RunLength encoding requires Int32 column, got type ${columnType}`,
        );
      }
      return decodeRleInt32(encoded.bytes, encoded.count);
    case EncodingTag.DeltaForInt:
      if (columnType !== ColumnTypeId.Int32) {
        throw new RangeError(
          `decodePage: DeltaForInt encoding requires Int32 column, got type ${columnType}`,
        );
      }
      return decodeDeltaForInt32(encoded.bytes);
    default:
      throw new RangeError(`decodePage: unknown encoding tag ${encoded.tag}`);
  }
}

function decodeRaw(encoded: EncodedColumn, columnType: ColumnTypeIdValue): ColumnArray {
  switch (columnType) {
    case ColumnTypeId.Int32:
      return decodeRawInt32(encoded.bytes, encoded.count);
    case ColumnTypeId.Uint32:
      return decodeRawUint32(encoded.bytes, encoded.count);
    case ColumnTypeId.Int64:
      return decodeRawInt64(encoded.bytes, encoded.count);
    case ColumnTypeId.Float64:
      return decodeRawFloat64(encoded.bytes, encoded.count);
    default:
      throw new RangeError(`decodePage: Raw encoding does not support column type ${columnType}`);
  }
}
