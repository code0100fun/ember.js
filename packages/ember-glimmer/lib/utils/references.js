import { get } from 'ember-metal/property_get';
import { tagFor } from 'ember-metal/tags';
import { CURRENT_TAG, CONSTANT_TAG, VOLATILE_TAG, ConstReference, DirtyableTag, UpdatableTag, combine, combineTagged } from 'glimmer-reference';
import { ConditionalReference as GlimmerConditionalReference } from 'glimmer-runtime';
import emberToBool from './to-bool';
import { RECOMPUTE_TAG } from '../helper';
import { dasherize } from 'ember-runtime/system/string';

// @implements PathReference
export class PrimitiveReference extends ConstReference {
  get() {
    return NULL_REFERENCE;
  }
}

export const NULL_REFERENCE = new ConstReference(null);

// @abstract
// @implements PathReference
class EmberPathReference {
  // @abstract get tag()
  // @abstract value()

  get(key) {
    return new PropertyReference(this, key);
  }
}

// @abstract
class CachedReference extends EmberPathReference {
  constructor() {
    super();
    this._lastRevision = null;
    this._lastValue = null;
  }

  value() {
    let { tag, _lastRevision, _lastValue } = this;

    if (!_lastRevision || !tag.validate(_lastRevision)) {
      this._lastRevision = tag.value();
      _lastValue = this._lastValue = this.compute();
    }

    return _lastValue;
  }

  invalidate() {
    this._lastRevision = null;
  }

  // @abstract compute()
}

// @implements PathReference
export class RootReference extends ConstReference {
  get(propertyKey) {
    return new PropertyReference(this, propertyKey);
  }
}

class PropertyReference extends CachedReference { // jshint ignore:line
  constructor(parentReference, propertyKey) {
    super();

    let parentReferenceTag = parentReference.tag;
    let parentObjectTag = new UpdatableTag(CURRENT_TAG);

    this.tag = combine([parentReferenceTag, parentObjectTag]);
    this._parentReference = parentReference;
    this._parentObjectTag = parentObjectTag;
    this._propertyKey = propertyKey;
  }

  compute() {
    let { _parentReference, _parentObjectTag, _propertyKey } = this;

    let parentValue = _parentReference.value();

    _parentObjectTag.update(tagFor(parentValue));

    if (parentValue && typeof parentValue === 'object') {
      return get(parentValue, _propertyKey);
    } else {
      return null;
    }
  }

  get(propertyKey) {
    return new PropertyReference(this, propertyKey);
  }
}

export class UpdatableReference extends EmberPathReference {
  constructor(value) {
    super();

    this.tag = new DirtyableTag();
    this._value = value;
  }

  value() {
    return this._value;
  }

  update(value) {
    this.tag.dirty();
    this._value = value;
  }
}

// @implements PathReference
export class GetHelperReference extends CachedReference {
  constructor(sourceReference, pathReference) {
    super();
    this.sourceReference = sourceReference;
    this.pathReference = pathReference;
    this.tag = combineTagged([sourceReference, pathReference]);
  }

  isDirty() { return true; }

  compute() {
    let key = this.pathReference.value();
    let keyType = typeof key;

    if (key && (keyType === 'string' || keyType === 'number')) {
      return this.sourceReference.get(key).value();
    }

    return null;
  }

  get(propertyKey) {
    return new PropertyReference(this, propertyKey);
  }

  destroy() {}
}

export class HashHelperReference extends CachedReference {
  constructor(args) {
    super();

    this.tag = args.named.tag;
    this.namedArgs = args.named;
  }

  compute() {
    return this.namedArgs.value();
  }
}

export class ConditionalReference extends GlimmerConditionalReference {
  constructor(reference) {
    super(reference);

    // this.objectTag = new UpdatableTag(CURRENT_TAG);
    // this.tag = combine([reference.tag, this.objectTag]);

    // FIXME: fix failing proxy tests
    this.tag = VOLATILE_TAG;
  }

  toBool(predicate) {
    // this.objectTag.update(tagFor(predicate));
    return emberToBool(predicate);
  }
}

export class ConstConditionalReference extends ConstReference {
  constructor(reference) {
    super(emberToBool(reference.value()));
  }
}

export class SimpleHelperReference extends CachedReference {
  constructor(helper, args) {
    super();

    this.tag = args.tag;
    this.helper = helper;
    this.args = args;
  }

  compute() {
    let { helper, args: { positional, named } } = this;
    return helper(positional.value(), named.value());
  }
}

export class ClassBasedHelperReference extends CachedReference {
  constructor(instance, args) {
    super();

    this.tag = combine([instance[RECOMPUTE_TAG], args.tag]);
    this.instance = instance;
    this.args = args;
  }

  compute() {
    let { instance, args: { positional, named } } = this;
    return instance.compute(positional.value(), named.value());
  }
}

export class InternalHelperReference extends CachedReference {
  constructor(helper, args) {
    super();

    this.tag = args.tag;
    this.helper = helper;
    this.args = args;
  }

  compute() {
    let { helper, args } = this;
    return helper(args);
  }
}

import { assert } from 'ember-metal/debug';

export class AttributeBindingReference extends CachedReference {
  static apply(component, microsyntax, operations) {
    let reference = this.parse(component, microsyntax);
    operations.addAttribute(reference.attributeName, reference);
  }

  static parse(component, microsyntax) {
    let colonIndex = microsyntax.indexOf(':');

    if (colonIndex === -1) {
      assert('You cannot use class as an attributeBinding, use classNameBindings instead.', microsyntax !== 'class');
      return new this(component, microsyntax);
    } else {
      let prop = microsyntax.substring(0, colonIndex);
      let attr = microsyntax.substring(colonIndex + 1);

      assert('You cannot use class as an attributeBinding, use classNameBindings instead.', attr !== 'class');

      return new this(component, prop, attr);
    }
  }

  constructor(component, propertyPath, attributeName=propertyPath) {
    super();

    if (propertyPath.indexOf('.') > -1) {
      // For bindings like `foo.bar.baz`, just checking the tag for the component itself is not enough.
      this.tag = CURRENT_TAG;
    } else {
      this.tag = tagFor(component);
    }

    this.component = component;
    this.propertyPath = propertyPath;
    this.attributeName = attributeName;
  }

  compute() {
    let value = get(this.component, this.propertyPath);

    if (value === null || value === undefined) {
      return null;
    } else {
      return value;
    }
  }
}

export function applyClassNameBinding(component, microsyntax, operations) {
  let [ prop, truthy, falsy ] = microsyntax.split(':');
  let ref;

  if (truthy !== undefined) {
    ref = new ColonClassNameBindingReference(component, prop, truthy, falsy);
  } else {
    ref = new SimpleClassNameBindingReference(component, prop);
  }

  operations.addAttribute('class', ref);
}

class SimpleClassNameBindingReference extends CachedReference {
  constructor(component, propertyPath) {
    super();

    if (propertyPath.indexOf('.') > -1) {
      // For bindings like `foo.bar.baz`, just checking the tag for the component itself is not enough.
      this.tag = CURRENT_TAG;
    } else {
      this.tag = tagFor(component);
    }

    this.component = component;
    this.propertyPath = propertyPath;
  }

  compute() {
    let value = get(this.component, this.propertyPath);

    if (value === true) {
      return propertyPathToClassName(this.propertyPath);
    } else if (value || value === 0) {
      return value;
    } else {
      return null;
    }
  }
}

class ColonClassNameBindingReference extends CachedReference {
  constructor(component, propertyPath, truthy, falsy) {
    super();

    if (propertyPath.indexOf('.') > -1) {
      // For bindings like `foo.bar.baz`, just checking the tag for the component itself is not enough.
      this.tag = CURRENT_TAG;
    } else {
      this.tag = tagFor(component);
    }

    this.component = component;
    this.propertyPath = propertyPath;
    this.truthy = truthy || null;
    this.falsy = falsy || null;
  }

  compute() {
    let value = get(this.component, this.propertyPath);
    return !!value ? this.truthy : this.falsy;
  }
}

function propertyPathToClassName(propertyPath) {
  let parts = propertyPath.split('.');
  let last = parts[parts.length - 1];

  return dasherize(last);
}

const EMPTY_OBJECT = {};

// @implements PathReference
export class UnboundReference {
  constructor(sourceRef, key = null) {
    this.tag = CONSTANT_TAG;
    this.sourceRef = sourceRef;
    this.key = key;
    this.cache = EMPTY_OBJECT;
  }

  value() {
    let { cache } = this;

    if (cache === EMPTY_OBJECT) {
      let { key, sourceRef } = this;
      let sourceVal = sourceRef.value();
      cache = this.cache = key ? get(sourceVal, key) : sourceVal;
    }

    return cache;
  }

  get(key) {
    return new UnboundReference(this, key);
  }

  destroy() {}
}
