import { describe, expect, test } from 'bun:test';
import { classifyFrame } from '../src/classifier';
import type { Frame } from '../src/types';

describe('classifyFrame — explicit override', () => {
  test('frame.in_app=true wins regardless of path', () => {
    const frame: Frame = { in_app: true, abs_path: '/srv/site-packages/foo.py' };
    expect(classifyFrame(frame, 'python')).toBe(true);
  });

  test('frame.in_app=false wins regardless of path', () => {
    const frame: Frame = { in_app: false, module: 'app.api.users' };
    expect(classifyFrame(frame, 'python')).toBe(false);
  });
});

describe('classifyFrame — python', () => {
  test('site-packages is system', () => {
    expect(
      classifyFrame({ abs_path: '/usr/lib/python3.11/site-packages/django/views.py' }, 'python'),
    ).toBe(false);
  });

  test('dist-packages is system', () => {
    expect(
      classifyFrame({ abs_path: '/usr/lib/python3/dist-packages/requests/api.py' }, 'python'),
    ).toBe(false);
  });

  test('python stdlib path is system', () => {
    expect(classifyFrame({ abs_path: '/usr/lib/python3.11/json/decoder.py' }, 'python')).toBe(
      false,
    );
  });

  test('app code is in-app', () => {
    expect(classifyFrame({ abs_path: '/srv/app/api/users.py' }, 'python')).toBe(true);
  });
});

describe('classifyFrame — javascript / node', () => {
  test('node_modules is system', () => {
    expect(classifyFrame({ abs_path: '/srv/app/node_modules/lodash/index.js' }, 'javascript')).toBe(
      false,
    );
  });

  test('webpack:// is system', () => {
    expect(classifyFrame({ abs_path: 'webpack:///vendor.js' }, 'javascript')).toBe(false);
  });

  test('app source is in-app', () => {
    expect(classifyFrame({ abs_path: '/srv/app/src/api/users.ts' }, 'javascript')).toBe(true);
  });
});

describe('classifyFrame — java / kotlin', () => {
  test('java.* prefix is system', () => {
    expect(classifyFrame({ module: 'java.util.HashMap' }, 'java')).toBe(false);
  });

  test('kotlin.* prefix is system', () => {
    expect(classifyFrame({ module: 'kotlin.collections.MutableMap' }, 'java')).toBe(false);
  });

  test('app code is in-app', () => {
    expect(classifyFrame({ module: 'com.example.app.UserService' }, 'java')).toBe(true);
  });
});

describe('classifyFrame — swift', () => {
  test('Foundation / UIKit / SwiftUI are system', () => {
    for (const mod of ['Foundation.NSString', 'UIKit.UIViewController', 'SwiftUI.View']) {
      expect(classifyFrame({ module: mod }, 'swift')).toBe(false);
    }
  });

  test('app module is in-app', () => {
    expect(classifyFrame({ module: 'MyApp.AppDelegate' }, 'swift')).toBe(true);
  });
});

describe('classifyFrame — rust', () => {
  test('std::, core::, alloc:: are system', () => {
    for (const fn of ['std::panic::Location::caller', 'core::result::Result', 'alloc::vec::Vec']) {
      expect(classifyFrame({ function: fn }, 'rust')).toBe(false);
    }
  });

  test('crate code is in-app', () => {
    expect(classifyFrame({ function: 'my_app::api::users::create' }, 'rust')).toBe(true);
  });
});

describe('classifyFrame — go', () => {
  test('runtime, reflect, net/http are system', () => {
    for (const fn of ['runtime.gopanic', 'reflect.Value.Call', 'net/http.HandlerFunc.ServeHTTP']) {
      expect(classifyFrame({ function: fn }, 'go')).toBe(false);
    }
  });

  test('app code is in-app', () => {
    expect(classifyFrame({ function: 'my_app/api/users.Create' }, 'go')).toBe(true);
  });
});

describe('classifyFrame — unknown / missing platform', () => {
  test('missing platform → in_app=true by default', () => {
    expect(classifyFrame({ abs_path: '/anything' }, undefined)).toBe(true);
  });

  test('unknown platform → in_app=true by default', () => {
    expect(classifyFrame({ abs_path: '/anything' }, 'esoteric-lang')).toBe(true);
  });
});

describe('classifyFrame — empty frame', () => {
  test('frame with no identifying fields defaults to in_app', () => {
    expect(classifyFrame({}, 'python')).toBe(true);
  });
});
