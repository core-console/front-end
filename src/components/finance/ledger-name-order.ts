// Python 3.14 uses Unicode 16.0 for str.casefold(). These generated
// mappings keep browser behavior pinned to that backend ordering contract.
const CASE_FOLD_RANGES = [
  [0x41, 0x5a, 32],
  [0xc0, 0xd6, 32],
  [0xd8, 0xde, 32],
  [0x189, 0x18a, 205],
  [0x1b1, 0x1b2, 217],
  [0x388, 0x38a, 37],
  [0x38e, 0x38f, 63],
  [0x391, 0x3a1, 32],
  [0x3a3, 0x3ab, 32],
  [0x3fd, 0x3ff, -130],
  [0x400, 0x40f, 80],
  [0x410, 0x42f, 32],
  [0x531, 0x556, 48],
  [0x10a0, 0x10c5, 7264],
  [0x13f8, 0x13fd, -8],
  [0x1c83, 0x1c84, -6210],
  [0x1c90, 0x1cba, -3008],
  [0x1cbd, 0x1cbf, -3008],
  [0x1f08, 0x1f0f, -8],
  [0x1f18, 0x1f1d, -8],
  [0x1f28, 0x1f2f, -8],
  [0x1f38, 0x1f3f, -8],
  [0x1f48, 0x1f4d, -8],
  [0x1f68, 0x1f6f, -8],
  [0x1fb8, 0x1fb9, -8],
  [0x1fba, 0x1fbb, -74],
  [0x1fc8, 0x1fcb, -86],
  [0x1fd8, 0x1fd9, -8],
  [0x1fda, 0x1fdb, -100],
  [0x1fe8, 0x1fe9, -8],
  [0x1fea, 0x1feb, -112],
  [0x1ff8, 0x1ff9, -128],
  [0x1ffa, 0x1ffb, -126],
  [0x2160, 0x216f, 16],
  [0x24b6, 0x24cf, 26],
  [0x2c00, 0x2c2f, 48],
  [0x2c7e, 0x2c7f, -10815],
  [0xab70, 0xabbf, -38864],
  [0xff21, 0xff3a, 32],
  [0x10400, 0x10427, 40],
  [0x104b0, 0x104d3, 40],
  [0x10570, 0x1057a, 39],
  [0x1057c, 0x1058a, 39],
  [0x1058c, 0x10592, 39],
  [0x10594, 0x10595, 39],
  [0x10c80, 0x10cb2, 64],
  [0x10d50, 0x10d65, 32],
  [0x118a0, 0x118bf, 32],
  [0x16e40, 0x16e5f, 32],
  [0x1e900, 0x1e921, 34],
] as const;

const CASE_FOLD_EXCEPTIONS = [
  "b5=3bc;df=73.73;100=101;102=103;104=105;106=107;108=109;10a=10b;10c=10d;10e=10f;110=111;112=113;114=115;116=117;118=119;11a=11b;11c=11d;11e=11f;120=121;122=123;124=125;126=127;128=129;12a=12b;12c=12d;12e=12f;130=69.307;132=133;134=135;136=137;139=13a;13b=13c;13d=13e;13f=140;141=142;143=144;145=146;147=148;149=2bc.6e;14a=14b;14c=14d;14e=14f;150=151;152=153;154=155;156=157;158=159;15a=15b;15c=15d;15e=15f;160=161;162=163;164=165;166=167;168=169;16a=16b;16c=16d;16e=16f;170=171;172=173;174=175;",
  "176=177;178=ff;179=17a;17b=17c;17d=17e;17f=73;181=253;182=183;184=185;186=254;187=188;18b=18c;18e=1dd;18f=259;190=25b;191=192;193=260;194=263;196=269;197=268;198=199;19c=26f;19d=272;19f=275;1a0=1a1;1a2=1a3;1a4=1a5;1a6=280;1a7=1a8;1a9=283;1ac=1ad;1ae=288;1af=1b0;1b3=1b4;1b5=1b6;1b7=292;1b8=1b9;1bc=1bd;1c4=1c6;1c5=1c6;1c7=1c9;1c8=1c9;1ca=1cc;1cb=1cc;1cd=1ce;1cf=1d0;1d1=1d2;1d3=1d4;1d5=1d6;1d7=1d8;1d9=1da;1db=1dc;1de=1df;1e0=1e1;1e2=1e3;1e4=1e5;1e6=1e7;1e8=1e9;1ea=1eb;1ec=1ed;1ee=1ef;1f0=6a.30c;",
  "1f1=1f3;1f2=1f3;1f4=1f5;1f6=195;1f7=1bf;1f8=1f9;1fa=1fb;1fc=1fd;1fe=1ff;200=201;202=203;204=205;206=207;208=209;20a=20b;20c=20d;20e=20f;210=211;212=213;214=215;216=217;218=219;21a=21b;21c=21d;21e=21f;220=19e;222=223;224=225;226=227;228=229;22a=22b;22c=22d;22e=22f;230=231;232=233;23a=2c65;23b=23c;23d=19a;23e=2c66;241=242;243=180;244=289;245=28c;246=247;248=249;24a=24b;24c=24d;24e=24f;345=3b9;370=371;372=373;376=377;37f=3f3;386=3ac;38c=3cc;390=3b9.308.301;3b0=3c5.308.301;3c2=3c3;3cf=3d7;3d0=3b2;",
  "3d1=3b8;3d5=3c6;3d6=3c0;3d8=3d9;3da=3db;3dc=3dd;3de=3df;3e0=3e1;3e2=3e3;3e4=3e5;3e6=3e7;3e8=3e9;3ea=3eb;3ec=3ed;3ee=3ef;3f0=3ba;3f1=3c1;3f4=3b8;3f5=3b5;3f7=3f8;3f9=3f2;3fa=3fb;460=461;462=463;464=465;466=467;468=469;46a=46b;46c=46d;46e=46f;470=471;472=473;474=475;476=477;478=479;47a=47b;47c=47d;47e=47f;480=481;48a=48b;48c=48d;48e=48f;490=491;492=493;494=495;496=497;498=499;49a=49b;49c=49d;49e=49f;4a0=4a1;4a2=4a3;4a4=4a5;4a6=4a7;4a8=4a9;4aa=4ab;4ac=4ad;4ae=4af;4b0=4b1;4b2=4b3;4b4=4b5;4b6=4b7;",
  "4b8=4b9;4ba=4bb;4bc=4bd;4be=4bf;4c0=4cf;4c1=4c2;4c3=4c4;4c5=4c6;4c7=4c8;4c9=4ca;4cb=4cc;4cd=4ce;4d0=4d1;4d2=4d3;4d4=4d5;4d6=4d7;4d8=4d9;4da=4db;4dc=4dd;4de=4df;4e0=4e1;4e2=4e3;4e4=4e5;4e6=4e7;4e8=4e9;4ea=4eb;4ec=4ed;4ee=4ef;4f0=4f1;4f2=4f3;4f4=4f5;4f6=4f7;4f8=4f9;4fa=4fb;4fc=4fd;4fe=4ff;500=501;502=503;504=505;506=507;508=509;50a=50b;50c=50d;50e=50f;510=511;512=513;514=515;516=517;518=519;51a=51b;51c=51d;51e=51f;520=521;522=523;524=525;526=527;528=529;52a=52b;52c=52d;52e=52f;587=565.582;",
  "10c7=2d27;10cd=2d2d;1c80=432;1c81=434;1c82=43e;1c85=442;1c86=44a;1c87=463;1c88=a64b;1c89=1c8a;1e00=1e01;1e02=1e03;1e04=1e05;1e06=1e07;1e08=1e09;1e0a=1e0b;1e0c=1e0d;1e0e=1e0f;1e10=1e11;1e12=1e13;1e14=1e15;1e16=1e17;1e18=1e19;1e1a=1e1b;1e1c=1e1d;1e1e=1e1f;1e20=1e21;1e22=1e23;1e24=1e25;1e26=1e27;1e28=1e29;1e2a=1e2b;1e2c=1e2d;1e2e=1e2f;1e30=1e31;1e32=1e33;1e34=1e35;1e36=1e37;1e38=1e39;1e3a=1e3b;1e3c=1e3d;1e3e=1e3f;1e40=1e41;1e42=1e43;1e44=1e45;1e46=1e47;1e48=1e49;1e4a=1e4b;1e4c=1e4d;1e4e=1e4f;",
  "1e50=1e51;1e52=1e53;1e54=1e55;1e56=1e57;1e58=1e59;1e5a=1e5b;1e5c=1e5d;1e5e=1e5f;1e60=1e61;1e62=1e63;1e64=1e65;1e66=1e67;1e68=1e69;1e6a=1e6b;1e6c=1e6d;1e6e=1e6f;1e70=1e71;1e72=1e73;1e74=1e75;1e76=1e77;1e78=1e79;1e7a=1e7b;1e7c=1e7d;1e7e=1e7f;1e80=1e81;1e82=1e83;1e84=1e85;1e86=1e87;1e88=1e89;1e8a=1e8b;1e8c=1e8d;1e8e=1e8f;1e90=1e91;1e92=1e93;1e94=1e95;1e96=68.331;1e97=74.308;1e98=77.30a;1e99=79.30a;1e9a=61.2be;1e9b=1e61;1e9e=73.73;1ea0=1ea1;1ea2=1ea3;1ea4=1ea5;1ea6=1ea7;1ea8=1ea9;1eaa=1eab;",
  "1eac=1ead;1eae=1eaf;1eb0=1eb1;1eb2=1eb3;1eb4=1eb5;1eb6=1eb7;1eb8=1eb9;1eba=1ebb;1ebc=1ebd;1ebe=1ebf;1ec0=1ec1;1ec2=1ec3;1ec4=1ec5;1ec6=1ec7;1ec8=1ec9;1eca=1ecb;1ecc=1ecd;1ece=1ecf;1ed0=1ed1;1ed2=1ed3;1ed4=1ed5;1ed6=1ed7;1ed8=1ed9;1eda=1edb;1edc=1edd;1ede=1edf;1ee0=1ee1;1ee2=1ee3;1ee4=1ee5;1ee6=1ee7;1ee8=1ee9;1eea=1eeb;1eec=1eed;1eee=1eef;1ef0=1ef1;1ef2=1ef3;1ef4=1ef5;1ef6=1ef7;1ef8=1ef9;1efa=1efb;1efc=1efd;1efe=1eff;1f50=3c5.313;1f52=3c5.313.300;1f54=3c5.313.301;1f56=3c5.313.342;1f59=1f51;",
  "1f5b=1f53;1f5d=1f55;1f5f=1f57;1f80=1f00.3b9;1f81=1f01.3b9;1f82=1f02.3b9;1f83=1f03.3b9;1f84=1f04.3b9;1f85=1f05.3b9;1f86=1f06.3b9;1f87=1f07.3b9;1f88=1f00.3b9;1f89=1f01.3b9;1f8a=1f02.3b9;1f8b=1f03.3b9;1f8c=1f04.3b9;1f8d=1f05.3b9;1f8e=1f06.3b9;1f8f=1f07.3b9;1f90=1f20.3b9;1f91=1f21.3b9;1f92=1f22.3b9;1f93=1f23.3b9;1f94=1f24.3b9;1f95=1f25.3b9;1f96=1f26.3b9;1f97=1f27.3b9;1f98=1f20.3b9;1f99=1f21.3b9;1f9a=1f22.3b9;1f9b=1f23.3b9;1f9c=1f24.3b9;1f9d=1f25.3b9;1f9e=1f26.3b9;1f9f=1f27.3b9;1fa0=1f60.3b9;",
  "1fa1=1f61.3b9;1fa2=1f62.3b9;1fa3=1f63.3b9;1fa4=1f64.3b9;1fa5=1f65.3b9;1fa6=1f66.3b9;1fa7=1f67.3b9;1fa8=1f60.3b9;1fa9=1f61.3b9;1faa=1f62.3b9;1fab=1f63.3b9;1fac=1f64.3b9;1fad=1f65.3b9;1fae=1f66.3b9;1faf=1f67.3b9;1fb2=1f70.3b9;1fb3=3b1.3b9;1fb4=3ac.3b9;1fb6=3b1.342;1fb7=3b1.342.3b9;1fbc=3b1.3b9;1fbe=3b9;1fc2=1f74.3b9;1fc3=3b7.3b9;1fc4=3ae.3b9;1fc6=3b7.342;1fc7=3b7.342.3b9;1fcc=3b7.3b9;1fd2=3b9.308.300;1fd3=3b9.308.301;1fd6=3b9.342;1fd7=3b9.308.342;1fe2=3c5.308.300;1fe3=3c5.308.301;1fe4=3c1.313;",
  "1fe6=3c5.342;1fe7=3c5.308.342;1fec=1fe5;1ff2=1f7c.3b9;1ff3=3c9.3b9;1ff4=3ce.3b9;1ff6=3c9.342;1ff7=3c9.342.3b9;1ffc=3c9.3b9;2126=3c9;212a=6b;212b=e5;2132=214e;2183=2184;2c60=2c61;2c62=26b;2c63=1d7d;2c64=27d;2c67=2c68;2c69=2c6a;2c6b=2c6c;2c6d=251;2c6e=271;2c6f=250;2c70=252;2c72=2c73;2c75=2c76;2c80=2c81;2c82=2c83;2c84=2c85;2c86=2c87;2c88=2c89;2c8a=2c8b;2c8c=2c8d;2c8e=2c8f;2c90=2c91;2c92=2c93;2c94=2c95;2c96=2c97;2c98=2c99;2c9a=2c9b;2c9c=2c9d;2c9e=2c9f;2ca0=2ca1;2ca2=2ca3;2ca4=2ca5;2ca6=2ca7;",
  "2ca8=2ca9;2caa=2cab;2cac=2cad;2cae=2caf;2cb0=2cb1;2cb2=2cb3;2cb4=2cb5;2cb6=2cb7;2cb8=2cb9;2cba=2cbb;2cbc=2cbd;2cbe=2cbf;2cc0=2cc1;2cc2=2cc3;2cc4=2cc5;2cc6=2cc7;2cc8=2cc9;2cca=2ccb;2ccc=2ccd;2cce=2ccf;2cd0=2cd1;2cd2=2cd3;2cd4=2cd5;2cd6=2cd7;2cd8=2cd9;2cda=2cdb;2cdc=2cdd;2cde=2cdf;2ce0=2ce1;2ce2=2ce3;2ceb=2cec;2ced=2cee;2cf2=2cf3;a640=a641;a642=a643;a644=a645;a646=a647;a648=a649;a64a=a64b;a64c=a64d;a64e=a64f;a650=a651;a652=a653;a654=a655;a656=a657;a658=a659;a65a=a65b;a65c=a65d;a65e=a65f;a660=a661;",
  "a662=a663;a664=a665;a666=a667;a668=a669;a66a=a66b;a66c=a66d;a680=a681;a682=a683;a684=a685;a686=a687;a688=a689;a68a=a68b;a68c=a68d;a68e=a68f;a690=a691;a692=a693;a694=a695;a696=a697;a698=a699;a69a=a69b;a722=a723;a724=a725;a726=a727;a728=a729;a72a=a72b;a72c=a72d;a72e=a72f;a732=a733;a734=a735;a736=a737;a738=a739;a73a=a73b;a73c=a73d;a73e=a73f;a740=a741;a742=a743;a744=a745;a746=a747;a748=a749;a74a=a74b;a74c=a74d;a74e=a74f;a750=a751;a752=a753;a754=a755;a756=a757;a758=a759;a75a=a75b;a75c=a75d;a75e=a75f;",
  "a760=a761;a762=a763;a764=a765;a766=a767;a768=a769;a76a=a76b;a76c=a76d;a76e=a76f;a779=a77a;a77b=a77c;a77d=1d79;a77e=a77f;a780=a781;a782=a783;a784=a785;a786=a787;a78b=a78c;a78d=265;a790=a791;a792=a793;a796=a797;a798=a799;a79a=a79b;a79c=a79d;a79e=a79f;a7a0=a7a1;a7a2=a7a3;a7a4=a7a5;a7a6=a7a7;a7a8=a7a9;a7aa=266;a7ab=25c;a7ac=261;a7ad=26c;a7ae=26a;a7b0=29e;a7b1=287;a7b2=29d;a7b3=ab53;a7b4=a7b5;a7b6=a7b7;a7b8=a7b9;a7ba=a7bb;a7bc=a7bd;a7be=a7bf;a7c0=a7c1;a7c2=a7c3;a7c4=a794;a7c5=282;a7c6=1d8e;a7c7=a7c8;",
  "a7c9=a7ca;a7cb=264;a7cc=a7cd;a7d0=a7d1;a7d6=a7d7;a7d8=a7d9;a7da=a7db;a7dc=19b;a7f5=a7f6;fb00=66.66;fb01=66.69;fb02=66.6c;fb03=66.66.69;fb04=66.66.6c;fb05=73.74;fb06=73.74;fb13=574.576;fb14=574.565;fb15=574.56b;fb16=57e.576;fb17=574.56d;",
].join("");

const caseFoldExceptions = new Map(
  CASE_FOLD_EXCEPTIONS.split(";")
    .filter(Boolean)
    .map((entry) => {
      const [source, mapping] = entry.split("=") as [string, string];
      return [
        Number.parseInt(source, 16),
        String.fromCodePoint(
          ...mapping.split(".").map((value) => Number.parseInt(value, 16)),
        ),
      ] as const;
    }),
);

// PostgreSQL's UTF-8 `C` collation compares the folded keys byte by byte.
const utf8Encoder = new TextEncoder();

function backendCaseFold(value: string) {
  const folded: string[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const exception = caseFoldExceptions.get(codePoint);
    if (exception !== undefined) {
      folded.push(exception);
      continue;
    }

    const range = CASE_FOLD_RANGES.find(
      ([start, end]) => codePoint >= start && codePoint <= end,
    );
    folded.push(
      range === undefined
        ? character
        : String.fromCodePoint(codePoint + range[2]),
    );
  }
  return folded.join("");
}

function compareUtf8Bytes(left: string, right: string) {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function compareLedgerNamesByBackendOrder(
  left: { id: string; name: string },
  right: { id: string; name: string },
) {
  const nameOrder = compareUtf8Bytes(
    backendCaseFold(left.name),
    backendCaseFold(right.name),
  );
  return nameOrder !== 0 ? nameOrder : compareUtf8Bytes(left.id, right.id);
}
