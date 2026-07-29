import { ReactElement, useState, useEffect, useRef } from 'react';
import { withConditionalRender } from '../../../per-form';
import {
  Stack,
  Checkbox,
  TextField,
  Label,
  Icon,
  IconButton,
  ComboBox,
  ChoiceGroup,
  Dropdown,
  getTheme,
  mergeStyleSets,
  DatePicker,
  PrimaryButton,
  DefaultButton,
} from '@fluentui/react';
import { format, parseISO } from 'date-fns';
import { TyreGrid } from '../../../../components/shared/TyreGrid';
interface IndexableObject {
  [key: string]: any;
}
const getStyle = () => {
  const theme = getTheme();
  return mergeStyleSets({
    errors: {
      minHeight: '1.32em',
      fontSize: '0.8em',
      marginBottom: '0.5em',
    },
    error: { color: theme.semanticColors.errorText },
    hint: { color: theme.palette.themePrimary },
  });
};
const Feedback = withConditionalRender(
  ({ errors, dirty }: { errors: string[]; dirty?: boolean }) => {
    const style = getStyle();
    return (
      <Stack className={`${dirty ? style.error : style.hint}`}>
        {errors && errors[0]}
      </Stack>
    );
  }
);

export default function Raw(props: any): ReactElement {
  const {
    dirty,
    errors,
    label,
    name,
    onChange,
    onFocus,
    touched,
    type,
    value,
    placeholder,
    hint: _hint,
    parent: _parent,
    options: _o,
    ...rest
  }: any = props;
  const [option, setOption] = useState({ index: -1, value: '' });
  const [rawNum, setRawNum] = useState(String(value ?? ''));
  const numFocused = useRef(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!numFocused.current) setRawNum(String(value ?? ''));
  }, [value]);
  const options = props.options ? props.options : [];
  const isValid: boolean = errors ? errors.length === 0 : true;
  const isDirty: boolean = dirty ? dirty : false;
  const isTouched: boolean = touched ? touched : false;
  const style = getStyle();
  const theme = getTheme();

  function handleChange(e: any) {
    const { value } = e.target;
    onChange(name, value);
  }
  function handleMultiSelect(_: any, option: any) {
    let newValue = value;
    if (newValue === undefined || newValue === null || newValue === '') {
      newValue = [];
    }
    if (option.selected) {
      newValue.push(option.key);
      onChange(name, newValue);
    } else {
      onChange(
        name,
        newValue.filter((v: any) => v !== option.key)
      );
    }
  }
  function sign() {
    onChange(name, rest.signature);
  }
  function handleImageUpload(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await rest.uploadFn(reader.result as string, file.name);
        onChange(name, result);
      } finally {
        setImageUploading(false);
        if (imageFileInputRef.current) imageFileInputRef.current.value = '';
      }
    };
    reader.onerror = () => setImageUploading(false);
    reader.readAsDataURL(file);
  }
  function handleCheck(e: any) {
    const { checked } = e.target;
    onChange(name, checked);
  }

  function handleFocus(_: any) {
    onFocus && onFocus(name);
  }
  function handleSelect(_: any, option: any) {
    option !== undefined && onChange(name, option.key);
  }
  function handleSelectDate(date: Date | null | undefined) {
    date && onChange(name, new Date(format(date, "yyyy-MM-dd'T'00:00:00")));
  }

  function handleOptionChange(_: any, option: any) {
    setOption({ index: option.key, value: option.value });
  }
  function handleAdd() {
    onChange(
      name,
      [
        ...value,
        options.find((o: any) => option.value === o.value)?.value,
      ].sort((a, b) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1))
    );
    setOption({ index: -1, value: '' });
  }
  function handleRemove(e: any) {
    const target: IndexableObject = e.currentTarget;
    onChange(
      name,
      value
        .filter((v: any) => v !== target.id)
        .sort((a: any, b: any) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1))
    );
    setOption({ index: -1, value: '' });
  }
  function parseDate(val: any) {
    return (val && typeof val === 'string' ? parseISO(val) : val) || new Date();
  }
  function handleTimeChange(
    hour: number,
    minute: number,
    date: Date | null | string = new Date()
  ) {
    let newDate: Date;
    if (date === null || typeof date === 'string') {
      newDate = new Date();
    } else {
      newDate = date;
    }
    hour !== -1
      ? onChange(
          name,
          new Date(
            newDate.getFullYear(),
            newDate.getMonth(),
            newDate.getDate(),
            hour,
            minute,
            0
          )
        )
      : onChange(name, '');
  }

  function choose() {
    let i;
    const hours = [];
    const minutes = [];
    let hour: number;
    let minute: number;
    let ampm: string;
    switch (type) {
      case 'checkbox':
        return (
          <Stack className={rest.className}>
            <Checkbox
              label={label}
              checked={value}
              name={name}
              onChange={handleCheck}
              onFocus={handleFocus}
              {...rest}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'multicheckbox':
        return (
          <Stack horizontal wrap tokens={{ childrenGap: '0.77em' }}>
            {Object.entries(rest.fields).map(([k, f]: any) => (
              <Stack key={k} style={{ minWidth: '24em' }}>
                <Raw
                  name={k}
                  onChange={(subname: string, subvalue: any) =>
                    onChange(name, { ...value, [subname]: subvalue })
                  }
                  value={value[k]}
                  onFocus={handleFocus}
                  {...f}
                />
              </Stack>
            ))}
          </Stack>
        );
      case 'radio':
        return (
          <Stack className={rest.className}>
            <ChoiceGroup
              label={label}
              onChange={handleChange}
              options={options.map(
                (
                  { text, value: optValue }: { text: string; value: any },
                  _: number
                ) => ({ key: optValue, text })
              )}
              {...rest}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'select':
        return (
          <Stack className={rest.className}>
            <Dropdown
              label={label}
              onChange={handleSelect}
              onFocus={handleFocus}
              selectedKey={value}
              options={options.map(
                (
                  { text, value: optValue, disabled }: { text: string; value: any; disabled?: boolean },
                  _: number
                ) => ({ key: optValue, text, disabled })
              )}
              {...rest}
            >
              {}
            </Dropdown>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'multi-select':
        return (
          <Stack className={rest.className}>
            <Dropdown
              label={label}
              multiSelect
              onChange={handleMultiSelect}
              onFocus={handleFocus}
              selectedKeys={value}
              options={options.map(
                (
                  { text, value: optValue, disabled }: { text: string; value: any; disabled?: boolean },
                  _: number
                ) => ({ key: optValue, text, disabled })
              )}
              {...rest}
            >
              {}
            </Dropdown>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      // rest.gamepadMappings: GamepadMapping[] (id/name/mappingType/index),
      // rest.gamepadFilter?: 'button' | 'axis' narrows the list. Value is a
      // mapping id, or '' / undefined for unassigned.
      case 'gamepad-select': {
        const AXIS_LABELS = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'];
        const filtered = (rest.gamepadMappings ?? []).filter(
          (m: any) => !rest.gamepadFilter || m.mappingType === rest.gamepadFilter
        );
        return (
          <Stack className={rest.className}>
            {filtered.length === 0 ? (
              <>
                {label && <Label>{label}</Label>}
                <span style={{ fontSize: '0.8em', opacity: 0.5 }}>
                  No {rest.gamepadFilter ?? 'gamepad'} mappings defined — add them in Settings → Gamepad.
                </span>
              </>
            ) : (
              <Dropdown
                label={label}
                onChange={(_: any, option: any) => onChange(name, option?.key || undefined)}
                onFocus={handleFocus}
                selectedKey={value ?? ''}
                options={[
                  { key: '', text: '— unassigned —' },
                  ...filtered.map((m: any) => ({
                    key: m.id,
                    text: `${m.name} (${m.mappingType === 'button' ? `btn ${m.index}` : AXIS_LABELS[m.index] ?? `axis ${m.index}`})`,
                  })),
                ]}
              />
            )}
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      }
      // Value shape: { id, filename, url } | undefined. `rest.uploadFn(dataUrl,
      // filename): Promise<{id,filename,url}>` performs the actual network
      // upload and is required — the field itself has no opinion on where
      // images are stored, it just orchestrates picking a file, showing
      // upload/replace state, and committing whatever uploadFn resolves with.
      // `rest.resolveUrl(value)` optionally maps the stored (often
      // server-relative) url to a fully-qualified one for the <img> src.
      // `rest.allowClear` shows a delete icon that calls onChange(name,
      // undefined) instead of re-uploading.
      case 'image-upload':
        return (
          <Stack className={rest.className}>
            {label && <Label>{label}</Label>}
            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 12 }}>
              {value?.url ? (
                <img
                  src={rest.resolveUrl ? rest.resolveUrl(value) : value.url}
                  alt={value.filename}
                  style={{
                    width: 120, height: 68, objectFit: 'cover', borderRadius: 3,
                    flexShrink: 0, background: theme.palette.neutralLighter,
                  }}
                />
              ) : (
                rest.placeholderText && (
                  <span style={{ opacity: 0.6, fontSize: '0.9em', flex: 1 }}>{rest.placeholderText}</span>
                )
              )}
              <PrimaryButton disabled={imageUploading} onClick={() => imageFileInputRef.current?.click()}>
                {imageUploading ? 'Uploading…' : value?.url ? 'Replace' : (rest.uploadLabel ?? 'Upload')}
              </PrimaryButton>
              {rest.allowClear && value?.url && (
                <IconButton iconProps={{ iconName: 'Delete' }} onClick={() => onChange(name, undefined)} title="Remove" />
              )}
            </Stack>
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'picker':
        return (
          <Stack className={rest.className}>
            <Stack>
              <Label>{label}</Label>
              {value &&
                value.map((r: any, i: number) => (
                  <Stack
                    key={i}
                    horizontal
                    horizontalAlign={'space-between'}
                    verticalAlign={'center'}
                  >
                    {options.find((o: any) => o.value === r)?.text}
                    <IconButton id={r} onClick={handleRemove}>
                      <Icon iconName={'Remove'}></Icon>
                    </IconButton>
                  </Stack>
                ))}
            </Stack>
            <Stack horizontal>
              <ComboBox
                allowFreeform
                autoComplete={'on'}
                selectedKey={option.index}
                onChange={handleOptionChange}
                onFocus={handleFocus}
                placeholder={placeholder}
                options={options
                  .filter((o: any) => !value.includes(o.value))
                  .map(
                    (
                      { text, value: optValue }: { text: string; value: any },
                      i: number
                    ) => ({ key: i, text, value: optValue })
                  )}
                {...rest}
              />
              <IconButton disabled={option.value === ''} onClick={handleAdd}>
                <Icon iconName={'Add'}></Icon>
              </IconButton>
            </Stack>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'date':
        return (
          <Stack className={rest.className}>
            <DatePicker
              label={label}
              onSelectDate={handleSelectDate}
              formatDate={(val: any) => format(parseDate(val), 'yyyy-MM-dd')}
              value={
                new Date(value).toDateString() ===
                  new Date('3000-01-01').toDateString() || value === ''
                  ? undefined
                  : parseDate(value)
              }
              onFocus={handleFocus}
              placeholder={placeholder}
              allowTextInput={true}
              {...rest}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'datetime':
        for (i = 0; i < 60; i++) {
          i === 0 && hours.push({ key: i, text: '12' });
          i > 0 && i < 12 && hours.push({ key: i, text: `${i}` });
          i < 10
            ? minutes.push({ key: i, text: `0${i}` })
            : minutes.push({ key: i, text: `${i}` });
        }
        hour = value ? new Date(value).getHours() % 12 : -1;
        minute = value ? new Date(value).getMinutes() : 0;
        ampm = value ? (new Date(value).getHours() < 12 ? 'AM' : 'PM') : 'AM';
        return (
          <Stack className={rest.className}>
            <Label>label</Label>
            <Stack horizontal tokens={{ childrenGap: '0.77em' }}>
              <DatePicker
                onSelectDate={(date: Date | null | undefined) =>
                  handleTimeChange(hour, minute, date)
                }
                formatDate={(val: any) => format(parseDate(val), 'yyyy-MM-dd')}
                value={
                  new Date(value).toDateString() ===
                    new Date('3000-01-01').toDateString() || value === ''
                    ? undefined
                    : parseDate(value)
                }
                onFocus={handleFocus}
                placeholder={placeholder}
                allowTextInput={true}
                {...rest}
              />
              <ComboBox
                selectedKey={hour}
                options={[
                  { key: -1, text: '' },
                  ...(rest.hourOptions?.length > 0
                    ? rest.hourOptions
                        .map((o: any) => ({
                          key: o.value,
                          text: o.text,
                        }))
                        .sort((a: any, b: any) =>
                          parseInt(a.text) > parseInt(b.text) ? 1 : -1
                        )
                    : hours.sort((a, b) =>
                        parseInt(a.text) > parseInt(b.text) ? 1 : -1
                      )),
                ]}
                allowFreeform
                disabled={rest.disabled}
                autoComplete={'on'}
                onChange={(_: any, option: any) => {
                  ampm === 'AM'
                    ? handleTimeChange(option.key, minute, value)
                    : handleTimeChange(option.key + 12, minute, value);
                }}
              />
              <ComboBox
                selectedKey={minute}
                options={
                  rest.minuteOptions?.length > 0
                    ? rest.minuteOptions
                        .map((o: any) => ({
                          key: o.value,
                          text: o.text,
                        }))
                        .sort((a: any, b: any) =>
                          parseInt(a.text) > parseInt(b.text) ? 1 : -1
                        )
                    : minutes.sort((a: any, b: any) =>
                        parseInt(a.text) > parseInt(b.text) ? 1 : -1
                      )
                }
                allowFreeform
                disabled={rest.disabled}
                autoComplete={'on'}
                onChange={(_: any, option: any) =>
                  handleTimeChange(hour !== -1 ? hour : 0, option.key, value)
                }
              />
              <ComboBox
                selectedKey={ampm}
                options={[
                  { key: 'AM', text: 'AM' },
                  { key: 'PM', text: 'PM' },
                ]}
                disabled={rest && rest.disabled}
                onChange={(_: any, option: any) => {
                  option.key === 'AM'
                    ? handleTimeChange(hour !== -1 ? hour : 0, minute, value)
                    : handleTimeChange(
                        (hour !== -1 ? hour : 0) + 12,
                        minute,
                        value
                      );
                }}
              />
            </Stack>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'combobox':
        return (
          <Stack>
            <ComboBox
              label={label}
              allowFreeform
              autoComplete={'on'}
              text={value}              // ← use text instead of selectedKey for freeform
              selectedKey={             // ← only set key if value matches an option
                options.find((o: any) => o.value === value)?.value ?? null
              }
              onChange={(_: any, option: any, _index: any, freeformValue?: string) => {
                if (option) {
                  onChange(name, option.key);
                } else if (freeformValue !== undefined) {
                  onChange(name, freeformValue);
                }
              }}
              onFocus={handleFocus}
              placeholder={placeholder}
              options={options.map(
                (
                  { text, value: optValue }: { text: string; value: any },
                  _: number
                ) => ({ key: optValue, text, value: optValue })
              )}
              {...rest}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'timetoday':
        for (i = 0; i < 60; i++) {
          i === 0 && hours.push({ key: i, text: '12' });
          i > 0 && i < 12 && hours.push({ key: i, text: `${i}` });
          i < 10
            ? minutes.push({ key: i, text: `0${i}` })
            : minutes.push({ key: i, text: `${i}` });
        }
        hour = value ? new Date(value).getHours() % 12 : -1;
        minute = value ? new Date(value).getMinutes() : 0;
        ampm = value ? (new Date(value).getHours() < 12 ? 'AM' : 'PM') : 'AM';
        return (
          <Stack>
            <Label>{label}</Label>
            <Stack horizontal tokens={{ childrenGap: '0.77em' }}>
              <ComboBox
                selectedKey={hour}
                options={[
                  { key: -1, text: '' },
                  ...(rest.hourOptions?.length > 0
                    ? rest.hourOptions
                        .map((o: any) => ({
                          key: o.value,
                          text: o.text,
                        }))
                        .sort((a: any, b: any) =>
                          parseInt(a.text) > parseInt(b.text) ? 1 : -1
                        )
                    : hours.sort((a, b) =>
                        parseInt(a.text) > parseInt(b.text) ? 1 : -1
                      )),
                ]}
                allowFreeform
                disabled={rest.disabled}
                autoComplete={'on'}
                onChange={(_: any, option: any) => {
                  ampm === 'AM'
                    ? handleTimeChange(option.key, minute)
                    : handleTimeChange(option.key + 12, minute);
                }}
              />
              <ComboBox
                selectedKey={minute}
                options={
                  rest.minuteOptions?.length > 0
                    ? rest.minuteOptions
                        .map((o: any) => ({
                          key: o.value,
                          text: o.text,
                        }))
                        .sort((a: any, b: any) =>
                          parseInt(a.text) > parseInt(b.text) ? 1 : -1
                        )
                    : minutes.sort((a: any, b: any) =>
                        parseInt(a.text) > parseInt(b.text) ? 1 : -1
                      )
                }
                allowFreeform
                disabled={rest.disabled}
                autoComplete={'on'}
                onChange={(_: any, option: any) =>
                  handleTimeChange(hour !== -1 ? hour : 0, option.key)
                }
              />
              <ComboBox
                selectedKey={ampm}
                options={[
                  { key: 'AM', text: 'AM' },
                  { key: 'PM', text: 'PM' },
                ]}
                disabled={rest && rest.disabled}
                onChange={(_: any, option: any) => {
                  option.key === 'AM'
                    ? handleTimeChange(hour !== -1 ? hour : 0, minute)
                    : handleTimeChange((hour !== -1 ? hour : 0) + 12, minute);
                }}
              />
            </Stack>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'range':
      case 'slider':
        return (
          <Stack className={rest.className}>
            {label && (
              <Label style={{ paddingBottom: 2 }}>{label}</Label>
            )}
            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
              <input
                type="range"
                min={rest.min ?? 0}
                max={rest.max ?? 100}
                step={rest.step ?? 1}
                value={value ?? 0}
                disabled={rest.disabled}
                onChange={e => { const n = parseFloat(e.target.value); setRawNum(String(n)); onChange(name, n); }}
                onPointerDown={rest.onActivate}
                onPointerUp={rest.onDeactivate}
                style={{
                  flex: 1,
                  accentColor: theme.palette.themePrimary,
                  cursor: rest.disabled ? 'default' : 'pointer',
                  height: 20,
                  margin: 0,
                }}
              />
              <TextField
                type="number"
                min={rest.min ?? 0}
                max={rest.max ?? 100}
                step={rest.step ?? 1}
                value={rawNum}
                disabled={rest.disabled}
                onFocus={() => { numFocused.current = true; }}
                onChange={(_, newValue) => setRawNum(newValue ?? '')}
                onBlur={() => {
                  numFocused.current = false;
                  const n = parseFloat(rawNum);
                  if (!isNaN(n)) onChange(name, n);
                  else setRawNum(String(value ?? ''));
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const n = parseFloat(rawNum);
                    if (!isNaN(n)) onChange(name, n);
                    else setRawNum(String(value ?? ''));
                  }
                }}
                styles={{
                  root: { width: 60 },
                  fieldGroup: { height: 24 },
                  field: { textAlign: 'right', padding: '0 6px', fontSize: '0.85em' },
                }}
              />
            </Stack>
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      case 'button': {
        // Real Fluent buttons, not a manually-styled raw <button> — the
        // previous version approximated Fluent's primary color but lacked
        // its actual chrome (hover/focus states, padding, font weight),
        // which reads as visibly "not a Fluent button" next to real ones.
        // 'danger' matches ConfirmDialog.tsx's own existing convention
        // (PrimaryButton + a redDark background override), not a separate
        // one-off red style.
        const variant: 'primary' | 'danger' | 'default' = rest.variant ?? 'default';
        if (variant === 'default') {
          return (
            <DefaultButton onClick={rest.onClick} disabled={rest.disabled} styles={rest.buttonStyle ? { root: rest.buttonStyle } : undefined}>
              {label}
            </DefaultButton>
          );
        }
        return (
          <PrimaryButton
            onClick={rest.onClick}
            disabled={rest.disabled}
            styles={{
              root: {
                ...(variant === 'danger' ? { background: theme.palette.redDark, border: 'none' } : {}),
                ...rest.buttonStyle,
              },
            }}
          >
            {label}
          </PrimaryButton>
        );
      }
      case 'signature':
        return (
          <Stack className={rest.className}>
            <Label>{label}</Label>
            <Stack horizontal tokens={{ childrenGap: '0.77em' }}>
              <TextField
                disabled={true}
                name={name}
                onChange={handleChange}
                onFocus={handleFocus}
                value={value}
                {...rest}
              />
              <PrimaryButton onClick={sign}>Sign</PrimaryButton>
            </Stack>
          </Stack>
        );
      // Value shape: a Monocoque tyre-position string (e.g. "FrontLeft",
      // "All") | null. The corner-grid UI itself (click corners, Apply)
      // lives entirely in TyreGrid — this case just wires it into the
      // standard onChange(name, value) contract every other field type uses.
      case 'tyre-position':
        return (
          <Stack className={rest.className}>
            {label && <Label>{label}</Label>}
            <TyreGrid current={value ?? null} onApply={pos => onChange(name, pos)} />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
      // Escape hatch for a field with no standard representation (e.g. a
      // bespoke multi-button grid) — same onRender({ value, ... }) convention
      // ReactiveAdmin's List/CardList already use for custom columns, so a
      // schema.ts file (plain .ts, no JSX) declares the widget as its own
      // component and wires it in here via React.createElement.
      case 'custom':
        return rest.onRender({ value, onChange, name });
      default:
        return (
          <Stack className={rest.className}>
            <TextField
              label={label}
              name={name}
              onChange={handleChange}
              onFocus={handleFocus}
              value={value}
              placeholder={placeholder}
              {...rest}
            />
            <Stack className={style.errors}>
              <Feedback
                and={[!isValid, isTouched]}
                errors={errors}
                dirty={isDirty}
              />
            </Stack>
          </Stack>
        );
    }
  }
  return choose();
}
