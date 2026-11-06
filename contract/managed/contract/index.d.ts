import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Bundle = { secret: Uint8Array; uses: bigint };

export type Witnesses<PS> = {
  localSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  bundle(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Bundle];
  bundlePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                           path: { sibling: { field: bigint
                                                                                            },
                                                                                   goes_left: boolean
                                                                                 }[]
                                                                         }];
  useIndex(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>,
        owner_0: Uint8Array,
        uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  buy(context: __compactRuntime.CircuitContext<PS>,
      owner_0: Uint8Array,
      uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           to_0: { bytes: Uint8Array }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeem(context: __compactRuntime.CircuitContext<PS>, requestTag_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
}

export type ProvableCircuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>,
        owner_0: Uint8Array,
        uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  buy(context: __compactRuntime.CircuitContext<PS>,
      owner_0: Uint8Array,
      uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           to_0: { bytes: Uint8Array }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeem(context: __compactRuntime.CircuitContext<PS>, requestTag_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
}

export type PureCircuits = {
  ownerTag(secret_0: Uint8Array): Uint8Array;
  commitmentOf(owner_0: Uint8Array, uses_0: bigint): Uint8Array;
  bundleCommitment(b_0: Bundle): Uint8Array;
  nullifier(secret_0: Uint8Array, i_0: bigint): Uint8Array;
  publicKey(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  issue(context: __compactRuntime.CircuitContext<PS>,
        owner_0: Uint8Array,
        uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  buy(context: __compactRuntime.CircuitContext<PS>,
      owner_0: Uint8Array,
      uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           to_0: { bytes: Uint8Array }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeem(context: __compactRuntime.CircuitContext<PS>, requestTag_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  ownerTag(context: __compactRuntime.CircuitContext<PS>, secret_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  commitmentOf(context: __compactRuntime.CircuitContext<PS>,
               owner_0: Uint8Array,
               uses_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  bundleCommitment(context: __compactRuntime.CircuitContext<PS>, b_0: Bundle): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  nullifier(context: __compactRuntime.CircuitContext<PS>,
            secret_0: Uint8Array,
            i_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  publicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
}

export type Ledger = {
  readonly operator: Uint8Array;
  bundles: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  spent: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  tickets: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  readonly bundlesIssued: bigint;
  readonly creditsRedeemed: bigint;
  readonly pricePerCredit: bigint;
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>, price_0: bigint): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;
