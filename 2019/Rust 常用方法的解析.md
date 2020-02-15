# Rust 常用方法的解析

## str.to_owned
常用来将 &str 转换成 String，把数据从栈中复制到堆中，成为自己的数据

```rust
let s: &str = "a";
let ss: String = s.to_owned();

let v: &[i32] = &[1, 2];
let vv: Vec<i32> = v.to_owned();
```

str.to_owned源码的实现
```rust
#[stable(feature = "rust1", since = "1.0.0")]
impl ToOwned for str {
    type Owned = String;
    #[inline]
    fn to_owned(&self) -> String {
        unsafe { String::from_utf8_unchecked(self.as_bytes().to_owned()) }
    }

    fn clone_into(&self, target: &mut String) {
        let mut b = mem::take(target).into_bytes();
        self.as_bytes().clone_into(&mut b);
        *target = unsafe { String::from_utf8_unchecked(b) }
    }
}
```


## String.as_str
String 转 str